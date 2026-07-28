import { CONTENT_CHANNEL_PLAYBOOK } from '@/lib/content/playbook';
import { PLAYBOOKS } from '@/lib/pipeline/playbook';
import { PipelineContextSchema, PIPELINE_ROLES } from '@/lib/pipeline/types';
import { slugifyChannelLabel, toChannelContext } from '@/lib/content/channels';
import { CONTENT_INTEGRATIONS, contentIntegrationStatus, hasStageCredentials, isStageConfigured, resolveAssetsProvider, resolveScriptModel } from '@/lib/content/integrations';
import type { ChannelContext } from '@/lib/pipeline/types';
import type { ContentChannel } from '@/lib/types/database.types';

const CHANNEL: ChannelContext = {
  slug: 'medicare',
  label: 'Medicare',
  niche: 'Medicare education for US seniors',
  brandVoice: 'Plain, calm, and precise. Never promise coverage.',
  publishTargets: ['youtube'],
};

describe('content-channel playbook', () => {
  it('is registered on the shared engine registry (no second orchestrator)', () => {
    expect(PLAYBOOKS['content-channel']).toBe(CONTENT_CHANNEL_PLAYBOOK);
  });

  it('runs the five stages in pipeline order', () => {
    expect(CONTENT_CHANNEL_PLAYBOOK.steps.map((s) => s.role)).toEqual([
      'SCRIPT',
      'ASSETS',
      'VOICEOVER',
      'ASSEMBLY',
      'PUBLISH',
    ]);
  });

  it('uses only roles the shared context schema accepts', () => {
    for (const step of CONTENT_CHANNEL_PLAYBOOK.steps) {
      expect(PIPELINE_ROLES).toContain(step.role);
    }
  });

  it('injects the channel niche AND brand voice into every stage prompt', () => {
    // This is the whole "one shared strategist, N channels" mechanism — if a
    // stage stops carrying the channel, that channel silently loses its voice.
    for (const step of CONTENT_CHANNEL_PLAYBOOK.steps) {
      const prompt = step.buildSystemPrompt('test topic', 'prior', null, CHANNEL);
      expect(prompt).toContain(CHANNEL.niche);
      expect(prompt).toContain(CHANNEL.brandVoice);
      expect(prompt).toContain(CHANNEL.slug);
    }
  });

  it('degrades to an unscoped prompt when no channel is bound', () => {
    for (const step of CONTENT_CHANNEL_PLAYBOOK.steps) {
      expect(() => step.buildSystemPrompt('t', null, null, null)).not.toThrow();
      expect(step.buildSystemPrompt('t', null, null, null)).toContain('unscoped');
    }
  });

  it('simulates every stage deterministically and tags the channel', () => {
    for (const step of CONTENT_CHANNEL_PLAYBOOK.steps) {
      const a = step.simulateOutput('test topic', 'prior', CHANNEL);
      const b = step.simulateOutput('test topic', 'prior', CHANNEL);
      expect(a).toBe(b); // no clocks, no randomness — safe for snapshot traces
      expect(a).toContain('medicare');
      expect(a).toMatch(/SIMULATED/);
    }
  });

  it('never claims to have published in simulate mode', () => {
    const publish = CONTENT_CHANNEL_PLAYBOOK.steps.at(-1)!;
    const out = publish.simulateOutput('topic', null, CHANNEL);
    expect(out).toContain('NOT PUBLISHED');
    expect(out).toContain('youtube'); // reports the target it WOULD use
  });
});

describe('pipeline context carries the channel binding', () => {
  it('accepts a channel-scoped content context', () => {
    const parsed = PipelineContextSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      playbook: 'content-channel',
      step: 0,
      role: 'SCRIPT',
      objective: 'test',
      simulate: true,
      channelId: '22222222-2222-4222-8222-222222222222',
      channelSlug: 'faceless',
    });
    expect(parsed.success).toBe(true);
  });

  it('stays back-compatible with channel-less trading runs', () => {
    const parsed = PipelineContextSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      playbook: 'market-strategy',
      step: 0,
      role: 'RESEARCH',
      objective: 'test',
      simulate: true,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('script stage runs on existing credentials (no new signup)', () => {
  const saved = { anthropic: process.env.ANTHROPIC_API_KEY, groq: process.env.GROQ_API_KEY };
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = saved.anthropic;
    process.env.GROQ_API_KEY = saved.groq;
    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    if (saved.groq === undefined) delete process.env.GROQ_API_KEY;
  });

  it('is LIVE off Anthropic access alone, with no Groq key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.GROQ_API_KEY;
    expect(isStageConfigured('script')).toBe(true);
    expect(resolveScriptModel()).toBe('claude-haiku-4-5');
  });

  it('prefers Groq when its key is present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GROQ_API_KEY = 'gsk-test';
    expect(resolveScriptModel()).toContain('groq/');
  });

  it('degrades to simulate only when BOTH credentials are absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    expect(resolveScriptModel()).toBeNull();
    expect(isStageConfigured('script')).toBe(false);
  });

  it('binds the live path to the resolved lane via the step', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.GROQ_API_KEY;
    const script = CONTENT_CHANNEL_PLAYBOOK.steps[0];
    expect(script.isConfigured?.()).toBe(true);
    expect(script.resolveModel?.()).toBe('claude-haiku-4-5');
  });

  it('reports no missing requirement while it is live', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const script = contentIntegrationStatus().find((s) => s.stage === 'script')!;
    expect(script.configured).toBe(true);
    expect(script.missing).toEqual([]);
    // Groq is surfaced as an upgrade, never as a blocker.
    expect(script.availableUpgrades).toContain('GROQ_API_KEY');
  });
});

describe('assets stage — Pexels with Pixabay failover', () => {
  const saved = { pexels: process.env.PEXELS_API_KEY, pixabay: process.env.PIXABAY_API_KEY };
  afterEach(() => {
    for (const [k, v] of [['PEXELS_API_KEY', saved.pexels], ['PIXABAY_API_KEY', saved.pixabay]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('prefers Pexels when both keys are present', () => {
    process.env.PEXELS_API_KEY = 'pex';
    process.env.PIXABAY_API_KEY = 'pix';
    expect(resolveAssetsProvider()).toBe('pexels');
  });

  it('fails over to Pixabay when only Pixabay is set', () => {
    delete process.env.PEXELS_API_KEY;
    process.env.PIXABAY_API_KEY = 'pix';
    expect(resolveAssetsProvider()).toBe('pixabay');
    expect(hasStageCredentials('assets')).toBe(true);
  });

  it('resolves no provider when neither key is set', () => {
    delete process.env.PEXELS_API_KEY;
    delete process.env.PIXABAY_API_KEY;
    expect(resolveAssetsProvider()).toBeNull();
    expect(hasStageCredentials('assets')).toBe(false);
  });

  it('does NOT report LIVE on credentials alone — the fetch is still a TODO', () => {
    // The exact trap the script stage fell into: an env var must never by
    // itself advertise a capability the code path does not have.
    process.env.PEXELS_API_KEY = 'pex';
    expect(hasStageCredentials('assets')).toBe(true);
    expect(isStageConfigured('assets')).toBe(false);
    const assets = contentIntegrationStatus().find((s) => s.stage === 'assets')!;
    expect(assets.credentialsPresent).toBe(true);
    expect(assets.configured).toBe(false);
    // …and it must not claim a key is missing when one is present.
    expect(assets.missing).toEqual([]);
  });

  it('keeps the stage simulating while the fetch is unimplemented', () => {
    process.env.PEXELS_API_KEY = 'pex';
    expect(CONTENT_CHANNEL_PLAYBOOK.steps[1].isConfigured?.()).toBe(false);
  });
});

describe('per-stage gating', () => {
  it('gates every stage independently so a partial wiring still completes', () => {
    for (const step of CONTENT_CHANNEL_PLAYBOOK.steps) {
      expect(typeof step.isConfigured).toBe('function');
    }
  });

  it('keeps the four unwired stages stubbed regardless of Anthropic access', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const [, assets, voiceover, assembly, publish] = CONTENT_CHANNEL_PLAYBOOK.steps;
    expect(assets.isConfigured?.()).toBe(false);
    expect(voiceover.isConfigured?.()).toBe(false);
    expect(assembly.isConfigured?.()).toBe(false);
    // The outward-facing stage must not be live without its own credentials.
    expect(publish.isConfigured?.()).toBe(false);
  });

  it('requires BOTH of assembly’s integrations before it can run live', () => {
    process.env.WHISPER_MODEL_PATH = '/tmp/model';
    expect(CONTENT_CHANNEL_PLAYBOOK.steps[3].isConfigured?.()).toBe(false); // ffmpeg missing
    process.env.FFMPEG_PATH = '/usr/bin/ffmpeg';
    expect(CONTENT_CHANNEL_PLAYBOOK.steps[3].isConfigured?.()).toBe(true);
    delete process.env.WHISPER_MODEL_PATH;
    delete process.env.FFMPEG_PATH;
  });
});

describe('integration gating', () => {
  it('declares one integration per pipeline stage', () => {
    expect(CONTENT_INTEGRATIONS.map((s) => s.stage)).toEqual([
      'script',
      'assets',
      'voiceover',
      'subtitles',
      'assembly',
      'publish',
    ]);
  });

  it('reports a stage as unconfigured while its env var is unset', () => {
    delete process.env.KOKORO_TTS_URL;
    expect(isStageConfigured('voiceover')).toBe(false);
  });

  it('flips to configured once every env var for that stage is present', () => {
    // voiceover has no `implemented: false` guard, so credentials alone are
    // sufficient here — this is the plain env-var path.
    process.env.KOKORO_TTS_URL = 'http://127.0.0.1:8880';
    expect(isStageConfigured('voiceover')).toBe(true);
    delete process.env.KOKORO_TTS_URL;
  });

  it('separates CREDENTIALS from CAPABILITY for an unimplemented stage', () => {
    // assets carries `implemented: false`, so its key resolves credentials but
    // must not flip live readiness until the provider call is written.
    process.env.PEXELS_API_KEY = 'test-key';
    expect(hasStageCredentials('assets')).toBe(true);
    expect(isStageConfigured('assets')).toBe(false);
    delete process.env.PEXELS_API_KEY;
  });

  it('requires ALL env vars for a multi-key stage', () => {
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = 'x';
    expect(isStageConfigured('publish')).toBe(false); // instagram still missing
    process.env.INSTAGRAM_ACCESS_TOKEN = 'y';
    expect(isStageConfigured('publish')).toBe(true);
    delete process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });
});

describe('channel helpers', () => {
  it('slugifies a label into a lane-safe key', () => {
    expect(slugifyChannelLabel('Faceless')).toBe('faceless');
    expect(slugifyChannelLabel('  Home & Garden!  ')).toBe('home-garden');
    expect(slugifyChannelLabel('AI/ML Explained')).toBe('ai-ml-explained');
  });

  it('maps a row to prompt context and tolerates a malformed jsonb array', () => {
    const row = {
      id: 'x', slug: 'faceless', label: 'Faceless', niche: 'n', brand_voice: 'v',
      publish_targets: null as unknown as string[], active: true, created_at: '',
    } as ContentChannel;
    expect(toChannelContext(row).publishTargets).toEqual([]);
  });
});
