import { LIFE_CONTEXT_BLOCK_START } from './model-proposals';

/** Streams mentor-visible text while retaining the shortest suffix that could
 * still become the private proposal marker. Once the full marker appears,
 * all remaining model output is withheld for authoritative final parsing. */
export class LifeContextProposalHoldback {
  private held = '';
  private blocked = false;

  push(chunk: string): string {
    if (!chunk || this.blocked) return '';
    const combined = this.held + chunk;
    const markerAt = combined.indexOf(LIFE_CONTEXT_BLOCK_START);
    if (markerAt >= 0) {
      this.blocked = true;
      this.held = '';
      return combined.slice(0, markerAt);
    }
    let suffixLength = 0;
    const max = Math.min(combined.length, LIFE_CONTEXT_BLOCK_START.length - 1);
    for (let length = max; length > 0; length--) {
      if (combined.endsWith(LIFE_CONTEXT_BLOCK_START.slice(0, length))) {
        suffixLength = length;
        break;
      }
    }
    this.held = suffixLength ? combined.slice(-suffixLength) : '';
    return suffixLength ? combined.slice(0, -suffixLength) : combined;
  }

  flush(): string {
    if (this.blocked) return '';
    const visible = this.held;
    this.held = '';
    return visible;
  }
}
