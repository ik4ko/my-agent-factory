import { CeoReplyStreamer } from '../reply-stream';

/** Feed text in fixed-size chunks; returns everything the streamer surfaced. */
function stream(text: string, chunkSize: number): string {
  const s = new CeoReplyStreamer();
  let out = '';
  for (let i = 0; i < text.length; i += chunkSize) {
    out += s.push(text.slice(i, i + chunkSize));
  }
  out += s.flush();
  return out;
}

const CEO_JSON = '{"reply":"Market looks calm. I\'ll have Codex check the feed.","delegate":[{"to":"codex","task":"check the feed"}]}';

describe('CeoReplyStreamer — JSON-shaped output', () => {
  it.each([1, 2, 3, 7, 64, 4096])('streams only the reply field (chunk size %i)', (n) => {
    expect(stream(CEO_JSON, n)).toBe("Market looks calm. I'll have Codex check the feed.");
  });

  it('never surfaces delegate/email fields or JSON syntax', () => {
    const out = stream(CEO_JSON, 5);
    expect(out).not.toContain('{');
    expect(out).not.toContain('delegate');
    expect(out).not.toContain('codex"');
  });

  it('decodes JSON string escapes, including split-across-chunks escapes', () => {
    const text = '{"reply":"line one\\nline \\"two\\" \\u2014 done","delegate":[]}';
    for (const n of [1, 2, 3, 5]) {
      expect(stream(text, n)).toBe('line one\nline "two" — done');
    }
  });

  it('handles a ```json fence around the object', () => {
    const text = '```json\n{"reply":"fenced reply","delegate":[]}\n```';
    for (const n of [1, 4, 100]) {
      expect(stream(text, n)).toBe('fenced reply');
    }
  });

  it('emits nothing visible for JSON with no reply field (server done-event reconciles)', () => {
    expect(stream('{"delegate":[{"to":"codex","task":"x"}]}', 3)).toBe('');
  });
});

describe('CeoReplyStreamer — plain-text fallback (parseCeo parity)', () => {
  it.each([1, 3, 50])('streams non-JSON output verbatim (chunk size %i)', (n) => {
    const text = 'Just a plain spoken answer with no JSON at all.';
    expect(stream(text, n)).toBe(text);
  });

  it('flushes a short plain reply that never left the sniff buffer', () => {
    expect(stream('ok', 1)).toBe('ok');
  });

  it('does not misclassify leading whitespace before JSON', () => {
    expect(stream('   \n {"reply":"hi","delegate":[]}', 2)).toBe('hi');
  });
});
