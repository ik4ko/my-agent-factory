'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Cpu, Minus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** True only inside the Tauri webview — the same page served to browsers
 *  renders nothing, so the web build is untouched. */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Frameless-shell title bar (decorations: false). The container is the drag
 * region; the buttons are excluded automatically because data-tauri-drag-region
 * only applies to the element itself, and double-click-to-maximize on the
 * region comes free with the attribute.
 */
export function TitleBar() {
  const [mounted, setMounted] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri()) return;
    setMounted(true);

    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const sync = async () => setMaximized(await win.isMaximized());
      await sync();
      const unlisten = await win.onResized(() => void sync());
      if (cancelled) unlisten();
      else dispose = unlisten;
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const control = useCallback(async (action: 'minimize' | 'toggle' | 'close') => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    else if (action === 'toggle') await win.toggleMaximize();
    else await win.close();
  }, []);

  if (!mounted) return null;

  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center gap-2 border-b border-border bg-surface-1/80 pl-3 backdrop-blur"
    >
      <Cpu className="pointer-events-none size-3 text-primary" aria-hidden />
      <span className="pointer-events-none font-terminal text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        My Agent Factory
      </span>

      <div className="ml-auto flex h-full items-stretch">
        <button
          type="button"
          onClick={() => void control('minimize')}
          aria-label="Minimize window"
          className="flex w-11 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => void control('toggle')}
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          className="flex w-11 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {maximized ? <Copy className="size-3 -scale-x-100" aria-hidden /> : <Square className="size-3" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => void control('close')}
          aria-label="Close window"
          className={cn(
            'flex w-11 items-center justify-center text-muted-foreground/60 transition-colors',
            'hover:bg-neon-red/80 hover:text-white'
          )}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </header>
  );
}

export default TitleBar;
