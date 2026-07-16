'use client';

import { useState, useEffect } from 'react';

export function LiveClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => {
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York',
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-terminal text-[10px] text-muted-foreground/50 tabular">
      NYC {time}
    </span>
  );
}
