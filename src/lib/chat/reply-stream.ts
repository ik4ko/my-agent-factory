/**
 * Incremental extractor for the CEO lane's streamed output (Phase 1 streaming).
 *
 * The CEO brain replies in JSON — {"reply":"…","delegate":[…]} — so raw model
 * deltas must NOT reach the operator (they'd see JSON syntax typing itself
 * out). This class consumes raw deltas and emits only the visible reply text,
 * mirroring parseCeo's tolerance exactly:
 *
 *   - JSON-shaped output (possibly inside a ```json fence): stream the
 *     contents of the "reply" string field as it arrives, decoding JSON
 *     string escapes; stop at its closing quote (delegate/email fields
 *     never surface).
 *   - Plain-text output (parseCeo's fallback): stream it verbatim once the
 *     prefix rules out JSON.
 *
 * PRESENTATION-ONLY by design: the server's final `done` event always carries
 * parseCeo's authoritative result, so the client reconciles the provisional
 * text on completion. A wrong guess here can momentarily mis-render the live
 * preview; it can never corrupt history or the spoken/persisted reply.
 */

const REPLY_KEY = /"reply"\s*:\s*"/;
// Any string that is still a PREFIX of: whitespace + up to three backticks +
// (partial) "json" + whitespace. While the sniff buffer matches this, the
// output could still turn out to be a fenced JSON object.
const JSON_INTRO_PREFIX = /^\s*`{0,3}(?:j(?:s(?:o(?:n)?)?)?)?\s*$/i;
// How much prefix we buffer before concluding the output is not JSON.
// parseCeo's JSON candidates always open with '{' (optionally behind a fence);
// 24 chars comfortably covers whitespace + ```json + newline + '{'.
const SNIFF_LIMIT = 24;

type Mode = 'sniff' | 'seek-reply' | 'in-reply' | 'done-reply' | 'plain';

export class CeoReplyStreamer {
  private buffer = '';
  private mode: Mode = 'sniff';
  private escape = '';

  /** Feed one raw model delta; returns newly visible reply text (often ''). */
  push(delta: string): string {
    this.buffer += delta;
    let out = '';

    if (this.mode === 'sniff') {
      const head = this.buffer.replace(/^\s*(```(?:json)?\s*)?/i, '');
      if (head.startsWith('{')) {
        this.mode = 'seek-reply';
      } else if (this.buffer.length > SNIFF_LIMIT || !JSON_INTRO_PREFIX.test(this.buffer)) {
        // Buffer can no longer become "whitespace + optional ```json fence
        // + '{'" (or we're past any plausible intro) → plain-text output.
        this.mode = 'plain';
      }
      // else: still a valid prefix of a fence/whitespace intro — keep sniffing.
    }

    if (this.mode === 'plain') {
      out += this.buffer;
      this.buffer = '';
      return out;
    }

    if (this.mode === 'seek-reply') {
      const m = this.buffer.match(REPLY_KEY);
      if (m && m.index !== undefined) {
        this.buffer = this.buffer.slice(m.index + m[0].length);
        this.mode = 'in-reply';
      } else {
        // Keep only a tail that could still be a prefix of `"reply":"` .
        if (this.buffer.length > 512) this.buffer = this.buffer.slice(-32);
        return out;
      }
    }

    if (this.mode === 'in-reply') {
      out += this.drainReplyChars();
    }

    return out;
  }

  /** Emit anything still held back (e.g. sniff buffer on a tiny reply). */
  flush(): string {
    if (this.mode === 'sniff') {
      // Never surfaced anything — treat the whole buffer as plain text,
      // matching parseCeo's raw-text fallback for non-JSON output.
      const head = this.buffer.replace(/^\s*(```(?:json)?\s*)?/, '');
      const out = head.startsWith('{') ? '' : this.buffer;
      this.buffer = '';
      return out;
    }
    return '';
  }

  private drainReplyChars(): string {
    let out = '';
    let i = 0;
    const src = this.escape + this.buffer;
    this.escape = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        const esc = src.slice(i, i + (src[i + 1] === 'u' ? 6 : 2));
        const needed = src[i + 1] === 'u' ? 6 : 2;
        if (esc.length < needed) {
          // Escape split across chunks — hold it for the next push.
          this.escape = src.slice(i);
          i = src.length;
          break;
        }
        out += decodeEscape(esc);
        i += needed;
        continue;
      }
      if (ch === '"') {
        this.mode = 'done-reply';
        i = src.length; // delegate/email fields are never streamed
        break;
      }
      out += ch;
      i += 1;
    }
    this.buffer = '';
    return out;
  }
}

function decodeEscape(esc: string): string {
  switch (esc[1]) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'b': return '\b';
    case 'f': return '\f';
    case '"': return '"';
    case '\\': return '\\';
    case '/': return '/';
    case 'u': {
      const code = Number.parseInt(esc.slice(2, 6), 16);
      return Number.isNaN(code) ? '' : String.fromCharCode(code);
    }
    default: return esc.slice(1);
  }
}
