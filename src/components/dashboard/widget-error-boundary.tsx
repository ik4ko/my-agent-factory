'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  /** Human-readable widget name surfaced in the fallback. */
  name: string;
  children: ReactNode;
  /** Inline chip fallback for small chrome (pills, strips) instead of the
   *  panel-sized fallback — a crashed pill must not distort the TopBar. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a single dashboard widget. If the wrapped subtree throws during
 * render, only this panel shows a recoverable error state — the rest of the
 * control room keeps streaming. Reset re-mounts the children.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Widget:${this.props.name}] render error`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <button
          onClick={this.reset}
          title={`${this.props.name} crashed: ${error.message || 'unknown error'} — click to retry`}
          className="flex items-center gap-1 rounded-full border border-neon-red/30 bg-neon-red/10 px-2 py-0.5 font-terminal text-[9px] tracking-widest text-neon-red/80 hover:bg-neon-red/20"
        >
          <AlertTriangle className="size-2.5" /> {this.props.name.toUpperCase()} ✕
        </button>
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-neon-red/25 bg-neon-red/[0.04] p-4 text-center">
        <div className="flex items-center gap-1.5 text-neon-red/80">
          <AlertTriangle className="size-3.5" />
          <span className="font-terminal text-[10px] uppercase tracking-[0.3em]">
            {this.props.name} failed
          </span>
        </div>
        <p className="max-w-[14rem] font-terminal text-[10px] leading-relaxed text-muted-foreground/60">
          {error.message || 'This widget crashed but the rest of the dashboard is still live.'}
        </p>
        <button
          onClick={this.reset}
          className="inline-flex items-center gap-1.5 rounded-md border border-neon-red/30 bg-neon-red/10 px-3 py-1.5 font-terminal text-[10px] text-neon-red transition-colors hover:bg-neon-red/20"
        >
          <RotateCw className="size-3" /> Retry
        </button>
      </div>
    );
  }
}
