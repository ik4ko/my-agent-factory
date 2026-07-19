'use client';

import { useMotionStore } from './motion-store';

/**
 * Quiet WebAudio confirmation tones — E-STOP arm (220Hz) and staged-intent
 * approve (660Hz) ONLY, nothing else (HANDOFF_SPEC §5). Near-silent gain
 * envelope, gated behind the motion/still flag, wrapped in try/catch so a
 * blocked/unavailable AudioContext never breaks the caller.
 */
let ctx: AudioContext | null = null;

export function playTone(freq: 220 | 660): void {
  if (!useMotionStore.getState().motion) return;
  try {
    ctx = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // audio unavailable — stay silent
  }
}

export const playEstopArmTone = () => playTone(220);
export const playApproveTone = () => playTone(660);
