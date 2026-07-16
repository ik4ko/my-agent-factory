'use client';

import { EmergencyStop } from './emergency-stop';
import { GlobalVoiceControl } from './global-voice-control';
import { LiveClock } from './live-clock';

export function GlobalControls() {
  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div className="pointer-events-auto absolute right-3 top-1.5 flex items-center gap-2">
        <GlobalVoiceControl compact />
        <LiveClock />
        <EmergencyStop />
      </div>
    </div>
  );
}
