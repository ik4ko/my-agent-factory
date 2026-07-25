import { CONTENT_CHANNEL_PLAYBOOK } from '@/lib/content/playbook';
import { PLAYBOOKS } from '@/lib/pipeline/playbook';
import { PipelineContextSchema, PIPELINE_ROLES } from '@/lib/pipeline/types';
import { slugifyChannelLabel, toChannelContext } from '@/lib/content/channels';
import { CONTENT_INTEGRATIONS, isStageConfigured } from '@/lib/content/integrations';
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
    delete process.env.PEXELS_API_KEY;
    expect(isStageConfigured('assets')).toBe(false);
  });

  it('flips to configured once every env var for that stage is present', () => {
    process.env.PEXELS_API_KEY = 'test-key';
    expect(isStageConfigured('assets')).toBe(true);
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
