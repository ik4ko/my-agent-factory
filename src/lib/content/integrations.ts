/**
 * Content-pipeline external integrations — declaration + readiness gate.
 *
 * NOTHING here calls a real API yet. Each stage of the content playbook has
 * exactly one entry below describing the service it will use, the env var
 * that switches it on, and what happens while that var is unset (the stage
 * degrades to the engine's existing simulate path).
 *
 * The contract every future integration must honor:
 *   1. Add the real call inside the stage's `run` TODO — do NOT touch the
 *      room, the channel CRUD, or the pipeline engine to wire it in.
 *   2. Keep `isConfigured()` as the only gate. A missing key must degrade to
 *      simulate, never throw, so the pipeline always runs end-to-end.
 *
 * Keeping the map in one module means the room can render live "stubbed vs
 * real" status without every panel knowing about individual providers.
 */

export type ContentStageKey = 'script' | 'assets' | 'voiceover' | 'subtitles' | 'assembly' | 'publish';

export interface IntegrationSpec {
  stage: ContentStageKey;
  /** Human label for the room's status panel. */
  service: string;
  /** Env vars that must ALL be present for this stage to run for real. */
  envVars: string[];
  /** Vars that UPGRADE the stage but are not required — the stage is already
   *  live without them via credentials the app has. Reported separately so the
   *  room never shows "STUBBED · needs X" for something that already works. */
  optionalEnvVars?: string[];
  /** What the stage does once wired — shown in the room, and the TODO anchor. */
  plan: string;
  /** Why it is safe to run without it today. */
  simulateNote: string;
  /** Custom readiness for stages that can run on credentials the app ALREADY
   *  holds. Overrides the envVars check when present. */
  isReady?: () => boolean;
  /** What to report as missing when `isReady` fails — an isReady stage has no
   *  single required env var to point at. */
  missingLabel?: string[];
}

/** Anthropic access already exists in this app (mentor lanes + dispatcher). */
function hasAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
function hasGroq(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

/**
 * Model the SCRIPT stage runs on. Groq when a key exists (free tier, faster);
 * otherwise the Haiku lane, which needs no new signup because the app is
 * already authenticated against Anthropic. Returns null only when neither
 * credential is present, in which case the stage degrades to simulate.
 */
export function resolveScriptModel(): string | null {
  if (hasGroq()) return 'groq/llama-3.1-8b-instant';
  if (hasAnthropic()) return 'claude-haiku-4-5';
  return null;
}

/**
 * Providers chosen in the 2026-07-24 sourcing pass. Every one is free-tier
 * viable; none is wired yet because no key exists for any of them.
 */
export const CONTENT_INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    stage: 'script',
    // NOTE: this stage requires NO new signup. The app is already
    // authenticated against Anthropic (mentor lanes + dispatcher), so the
    // Haiku lane is a real, available backend today; GROQ_API_KEY is a
    // free-tier upgrade, not a prerequisite.
    service: 'Haiku lane (existing Anthropic access) · Groq free tier when GROQ_API_KEY is set',
    envVars: [],
    optionalEnvVars: ['GROQ_API_KEY'],
    isReady: () => resolveScriptModel() !== null,
    missingLabel: ['ANTHROPIC_API_KEY (or GROQ_API_KEY)'],
    plan: 'Generate hook + beat-sheet + VO script from the objective, in the channel brand voice.',
    simulateNote: 'Simulate emits a deterministic script skeleton stamped with the channel voice.',
  },
  {
    stage: 'assets',
    service: 'Pexels Video API (Pixabay as failover)',
    envVars: ['PEXELS_API_KEY'],
    plan: 'Resolve one stock clip per beat by keyword; store URLs + durations on the step output.',
    simulateNote: 'Simulate emits placeholder clip slots so downstream assembly has a shot list.',
  },
  {
    stage: 'voiceover',
    service: 'Kokoro TTS (self-hosted, Apache-2.0)',
    envVars: ['KOKORO_TTS_URL'],
    plan: 'Synthesize the VO track from the script; return an audio path + duration.',
    simulateNote: 'Simulate reports a synthetic duration derived from script length.',
  },
  {
    stage: 'subtitles',
    service: 'faster-whisper (local)',
    envVars: ['WHISPER_MODEL_PATH'],
    plan: 'Force-align the VO audio to produce word-level SRT for burned-in captions.',
    simulateNote: 'Simulate derives caption cue counts from the script without transcribing.',
  },
  {
    stage: 'assembly',
    service: 'FFmpeg (local binary)',
    envVars: ['FFMPEG_PATH'],
    plan: 'Compose clips + VO + burned captions into a vertical 1080x1920 MP4.',
    simulateNote: 'Simulate reports the render plan (resolution, clip count) without invoking ffmpeg.',
  },
  {
    stage: 'publish',
    service: 'YouTube Data API v3 · Instagram Graph API',
    envVars: ['YOUTUBE_OAUTH_REFRESH_TOKEN', 'INSTAGRAM_ACCESS_TOKEN'],
    plan: "Upload to each of the channel's publish_targets and record the returned post IDs.",
    simulateNote: 'Simulate lists the targets it WOULD publish to and explicitly uploads nothing.',
  },
] as const;

const BY_STAGE = new Map<ContentStageKey, IntegrationSpec>(
  CONTENT_INTEGRATIONS.map((spec) => [spec.stage, spec]),
);

/** Live-readiness for one stage: a custom `isReady` when the stage can run on
 *  credentials the app already holds, otherwise every required env var. */
export function isStageConfigured(stage: ContentStageKey): boolean {
  const spec = BY_STAGE.get(stage);
  if (!spec) return false;
  if (spec.isReady) return spec.isReady();
  return spec.envVars.length > 0 && spec.envVars.every((name) => Boolean(process.env[name]?.trim()));
}

export interface StageReadiness extends Omit<IntegrationSpec, 'isReady'> {
  configured: boolean;
  /** Required env vars still missing — drives the room's status panel copy.
   *  Empty for a stage that is live via existing credentials. */
  missing: string[];
  /** Optional upgrades not yet set (shown as a hint, never as blocking). */
  availableUpgrades: string[];
}

/** Readiness of every stage. Server-only (reads process.env); the room gets
 *  this through GET /api/content/integrations. Env var NAMES only, no values. */
export function contentIntegrationStatus(): StageReadiness[] {
  return CONTENT_INTEGRATIONS.map((spec) => {
    const configured = isStageConfigured(spec.stage);
    // A stage that is already live has nothing missing, even if some of its
    // optional vars are unset.
    const missing = configured
      ? []
      : spec.missingLabel ?? spec.envVars.filter((name) => !process.env[name]?.trim());
    const availableUpgrades = (spec.optionalEnvVars ?? []).filter((name) => !process.env[name]?.trim());
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isReady: _omit, ...rest } = spec;
    return { ...rest, configured, missing, availableUpgrades };
  });
}

/**
 * Whether a run can execute for real end-to-end. Today this is false for
 * every stage; it exists so the room can stop advertising "simulate" the
 * moment the last key lands, without a code change.
 */
export function isPipelineFullyWired(): boolean {
  return CONTENT_INTEGRATIONS.every((spec) => isStageConfigured(spec.stage));
}
