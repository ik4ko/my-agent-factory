import type { ChannelContext, PipelinePlaybook } from '@/lib/pipeline/types';
import { isStageConfigured, resolveScriptModel } from './integrations';

/**
 * content-channel — the five-stage faceless-content chain, harvested from
 * MoneyPrinterTurbo's pipeline shape:
 *
 *   SCRIPT    → hook + beat sheet + voiceover script
 *   ASSETS    → one stock clip per beat
 *   VOICEOVER → TTS track for the script
 *   ASSEMBLY  → subtitles + FFmpeg compose to a vertical MP4
 *   PUBLISH   → upload to the channel's publish_targets
 *
 * ONE playbook serves EVERY channel. Faceless / Medicare / Personal are not
 * separate playbooks, prompts, or agents — the channel's niche and brand
 * voice arrive as `channel` (runtime context from the content_channels row),
 * so adding a vertical is an INSERT, never a deploy.
 *
 * Stages gate INDEPENDENTLY via `isConfigured`. A live run executes each
 * stage whose integration has credentials and simulates the rest, so a
 * partially-wired playbook still completes end-to-end.
 *
 * Today SCRIPT is the only live-capable stage — it needs no new signup
 * because the app already holds Anthropic credentials (Haiku lane); Groq is
 * an optional free-tier upgrade. The other four remain stubbed and carry the
 * TODO anchor for their integration in buildSystemPrompt.
 */

/** Channel block prepended to every stage prompt. This IS the per-channel
 *  personalization — there is deliberately no other channel-aware branch. */
function channelBlock(channel: ChannelContext | null | undefined): string {
  if (!channel) return 'CHANNEL: (none — running unscoped)';
  return `CHANNEL: ${channel.label} (${channel.slug})
NICHE: ${channel.niche}
BRAND VOICE (obey exactly): ${channel.brandVoice}
PUBLISH TARGETS: ${channel.publishTargets.join(', ') || '(none configured)'}`;
}

/** Rendered into simulate output so a sandbox trace still shows which voice
 *  a real run would have used. */
function channelTag(channel: ChannelContext | null | undefined): string {
  return channel ? `${channel.label} (${channel.slug})` : 'unscoped';
}

function stageStatus(stage: Parameters<typeof isStageConfigured>[0]): string {
  return isStageConfigured(stage) ? 'LIVE' : 'STUBBED (no API key — simulate only)';
}

export const CONTENT_CHANNEL_PLAYBOOK: PipelinePlaybook = {
  name: 'content-channel',
  steps: [
    {
      role: 'SCRIPT',
      agentType: 'generic',
      nameHint: 'Strategist',
      describe: (objective) => `[SCRIPT 1/5] Script + hook: ${objective}`,
      // The ONLY stage that is live-capable today: it needs no new signup,
      // because the app already holds Anthropic credentials. Groq is a
      // free-tier upgrade when GROQ_API_KEY is present, not a prerequisite.
      isConfigured: () => isStageConfigured('script'),
      resolveModel: () => resolveScriptModel() ?? undefined,
      buildSystemPrompt: (objective, _priorOutput, _market, channel) =>
        `You are the content strategist for a short-form video channel.
Stage 1 of 5 — SCRIPT. Topic: "${objective}".
${channelBlock(channel)}

Write a vertical short-form video script (target 35-50 seconds spoken).
Structure exactly:
HOOK: one sentence, under 12 words, that earns the first three seconds
BEATS: 4-6 numbered beats, each one line — this is the shot list the asset stage will search against, so every beat must name a CONCRETE, filmable visual
VOICEOVER: the full spoken script, plain prose, no stage directions, no markdown
KEYWORDS: 4-6 comma-separated stock-footage search terms derived from the beats
CTA: one closing line
Ground rules: obey the BRAND VOICE above exactly. Never open with "in this video" or "did you know". Write for the ear, not the page.`,
      simulateOutput: (objective, _priorOutput, channel) =>
        `SCRIPT (SIMULATED · ${stageStatus('script')})
CHANNEL: ${channelTag(channel)}
HOOK: The one ${objective.split(' ').slice(0, 3).join(' ')} mistake costing you the most.
BEATS:
  1. Close-up: hands sorting paperwork on a kitchen table
  2. Wide: calendar with a circled deadline
  3. Over-shoulder: laptop screen showing a comparison table
  4. Close-up: pen checking a box on a form
VOICEOVER: (simulated ~42s of spoken script for "${objective}", written in the ${channelTag(channel)} voice)
KEYWORDS: paperwork, calendar deadline, laptop comparison, checklist, kitchen table
CTA: Follow for the next one.`,
    },
    {
      role: 'ASSETS',
      agentType: 'researcher',
      nameHint: 'Scout',
      describe: (objective) => `[ASSETS 2/5] Stock footage: ${objective}`,
      isConfigured: () => isStageConfigured('assets'),
      buildSystemPrompt: (objective, priorOutput, _market, channel) =>
        // TODO(assets): call the Pexels video search API (PEXELS_API_KEY),
        // Pixabay as failover. Resolve one clip per beat, prefer vertical
        // orientation and >= the beat's duration. Emit the SHOT LIST below.
        `You are the asset scout for a short-form video channel.
Stage 2 of 5 — ASSETS. Topic: "${objective}".
${channelBlock(channel)}
The script stage produced:
---
${priorOutput ?? '(script unavailable)'}
---
For each BEAT above, choose the stock-footage search query most likely to return a usable vertical clip.
Structure exactly:
SHOT LIST: numbered, one line per beat — "<beat> :: <search query> :: <seconds>"
FALLBACKS: an alternate query per beat for when the first returns nothing usable
LICENSE NOTE: confirm every source is free for commercial use without attribution`,
      simulateOutput: (objective, priorOutput, channel) =>
        `SHOT LIST (SIMULATED · ${stageStatus('assets')})
CHANNEL: ${channelTag(channel)}
No stock API was called${priorOutput ? '' : ' and no script was received'}. Placeholder slots so assembly has a shot list:
  1. paperwork sorting :: "hands paperwork desk" :: 6s
  2. calendar deadline :: "calendar deadline circle" :: 5s
  3. laptop comparison :: "person laptop table" :: 8s
  4. checklist :: "checklist pen form" :: 5s
FALLBACKS: generic office b-roll per slot
LICENSE NOTE: target sources (Pexels, Pixabay) are free for commercial use, no attribution required
TRACE: objective "${objective}"`,
    },
    {
      role: 'VOICEOVER',
      agentType: 'generic',
      nameHint: 'Narrator',
      describe: (objective) => `[VOICEOVER 3/5] TTS track: ${objective}`,
      isConfigured: () => isStageConfigured('voiceover'),
      buildSystemPrompt: (objective, priorOutput, _market, channel) =>
        // TODO(voiceover): POST the VOICEOVER block to a self-hosted Kokoro
        // endpoint (KOKORO_TTS_URL) and persist the returned audio path.
        `You are the voice director for a short-form video channel.
Stage 3 of 5 — VOICEOVER. Topic: "${objective}".
${channelBlock(channel)}
Prior stage output:
---
${priorOutput ?? '(shot list unavailable)'}
---
Prepare the voiceover request.
Structure exactly:
NARRATION: the exact text to synthesize, punctuation normalized for TTS (expand numerals and acronyms as they should be SPOKEN)
VOICE PROFILE: pace, energy, and tone consistent with the BRAND VOICE above
PAUSES: where to insert beats, as character offsets into NARRATION`,
      simulateOutput: (objective, priorOutput, channel) => {
        const words = (priorOutput ?? objective).split(/\s+/).length;
        const seconds = Math.max(20, Math.round(words / 2.5));
        return `VOICEOVER (SIMULATED · ${stageStatus('voiceover')})
CHANNEL: ${channelTag(channel)}
No TTS engine was invoked. Synthetic estimate from upstream text length:
NARRATION: ~${words} words
ESTIMATED DURATION: ~${seconds}s at 150 wpm
VOICE PROFILE: derived from the ${channelTag(channel)} brand voice
AUDIO ARTIFACT: none written — real runs emit an audio path here`;
      },
    },
    {
      role: 'ASSEMBLY',
      agentType: 'coder',
      nameHint: 'Editor',
      describe: (objective) => `[ASSEMBLY 4/5] Subtitles + render: ${objective}`,
      isConfigured: () => isStageConfigured('subtitles') && isStageConfigured('assembly'),
      buildSystemPrompt: (objective, priorOutput, _market, channel) =>
        // TODO(assembly): two integrations land here —
        //   (a) faster-whisper (WHISPER_MODEL_PATH) to force-align the VO
        //       into word-level SRT, and
        //   (b) FFmpeg (FFMPEG_PATH) to compose clips + VO + burned captions
        //       into a 1080x1920 MP4.
        `You are the editor for a short-form video channel.
Stage 4 of 5 — ASSEMBLY. Topic: "${objective}".
${channelBlock(channel)}
Prior stage output:
---
${priorOutput ?? '(voiceover unavailable)'}
---
Produce the render plan.
Structure exactly:
TIMELINE: clip order with in/out points aligned to the narration beats
CAPTIONS: burned-in caption style — font, size, position, max words per cue
RENDER SETTINGS: 1080x1920, 30fps, target bitrate, audio normalization target
QC CHECKS: what must be true before this is publishable`,
      simulateOutput: (objective, priorOutput, channel) =>
        `ASSEMBLY (SIMULATED · subtitles ${stageStatus('subtitles')} · render ${stageStatus('assembly')})
CHANNEL: ${channelTag(channel)}
Neither faster-whisper nor ffmpeg was invoked. Render plan only:
TIMELINE: 4 clips, sequential, cut on narration beats
CAPTIONS: burned-in, 3 words per cue, lower third, high-contrast
RENDER SETTINGS: 1080x1920 @ 30fps, ~8Mbps, audio normalized to -14 LUFS
QC CHECKS: caption never overlaps the safe zone · no clip repeats · VO does not clip
OUTPUT ARTIFACT: none written${priorOutput ? '' : ' (no upstream voiceover received)'}
TRACE: objective "${objective}"`,
    },
    {
      role: 'PUBLISH',
      agentType: 'generic',
      nameHint: 'Publisher',
      describe: (objective) => `[PUBLISH 5/5] Upload + metadata: ${objective}`,
      isConfigured: () => isStageConfigured('publish'),
      buildSystemPrompt: (objective, priorOutput, _market, channel) =>
        // TODO(publish): upload to each target in channel.publishTargets —
        // YouTube Data API v3 videos.insert (YOUTUBE_OAUTH_REFRESH_TOKEN,
        // 1600 quota units/upload against 10k/day) and Instagram Graph API
        // Reels (INSTAGRAM_ACCESS_TOKEN). Record returned post IDs.
        // SAFETY: this stage performs an OUTWARD-FACING publish. It must stay
        // behind the same human-approval posture as any consequential action —
        // do not enable an unattended auto-publish without an explicit gate.
        `You are the publisher for a short-form video channel.
Stage 5 of 5 — PUBLISH. Topic: "${objective}".
${channelBlock(channel)}
Prior stage output:
---
${priorOutput ?? '(render plan unavailable)'}
---
Produce the publish package for EACH target listed above.
Structure exactly:
TITLE: under 60 characters, no clickbait punctuation
DESCRIPTION: 2-3 sentences plus 3-5 hashtags
TAGS: 8-12 comma-separated
THUMBNAIL TEXT: 3-5 words maximum
PER-TARGET NOTES: any platform-specific constraint (e.g. Reels max 90s)
NOT PUBLISHED: state explicitly that nothing was uploaded and human approval is required.`,
      simulateOutput: (objective, _priorOutput, channel) => {
        const targets = channel?.publishTargets ?? [];
        return `PUBLISH (SIMULATED · ${stageStatus('publish')})
CHANNEL: ${channelTag(channel)}
TITLE: ${objective.slice(0, 55)}
DESCRIPTION: (simulated) A short explainer on "${objective}". #shorts
TAGS: simulated, placeholder, ${channel?.slug ?? 'unscoped'}
THUMBNAIL TEXT: ${objective.split(' ').slice(0, 3).join(' ').toUpperCase()}
WOULD PUBLISH TO: ${targets.length ? targets.join(', ') : '(no targets configured on this channel)'}
NOT PUBLISHED: nothing was uploaded. No platform API was called and no credentials exist. Real runs require explicit human approval before this stage performs an outward-facing publish.`;
      },
    },
  ],
} as const;
