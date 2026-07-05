'use client';

import { useEffect } from 'react';

/** Registers the app-shell service worker. Production-only — a dev-mode SW
 *  fights Turbopack's hot reload and caches nothing useful anyway. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw] registration failed', err));
  }, []);
  return null;
}
