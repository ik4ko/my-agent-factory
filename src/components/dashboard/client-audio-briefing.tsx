'use client';

import dynamic from 'next/dynamic';

const AudioBriefing = dynamic(
  () => import('@/components/dashboard/audio-briefing').then(mod => mod.AudioBriefing),
  { ssr: false }
);

export default AudioBriefing;
