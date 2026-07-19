import fs from 'fs';
import path from 'path';

/**
 * Encoding guard — makes double-encoded mojibake structurally unshippable.
 *
 * This bug class has now appeared twice (activity separators, July 2026; a
 * 453-sequence sweep across user-facing dashboard and local-voice strings,
 * fixed this week). It happens when a UTF-8 file is read as cp1252 and
 * re-saved as UTF-8: middle-dot (c2 b7) becomes c3 82 c2 b7, em-dash
 * (e2 80 94) becomes a c3 a2 e2… run, and the corruption ships straight
 * into UI copy and outbound messages. (Examples given in hex on purpose —
 * literal mojibake glyphs here would trip the guard on this very file.)
 *
 * If this test fails: the listed file was saved with the wrong encoding.
 * Fix the file's bytes (see git history of the July 2026 repair for the
 * transform), don't loosen the patterns.
 */

// Byte signatures of UTF-8-decoded-as-cp1252-re-encoded-as-UTF-8 text
// (identified by hex only — the glyphs themselves would trip this guard):
//   c3 82 c2 …  A-circumflex + punctuation (was a c2-lead char: middle dot, NBSP)
//   c3 a2 e2 …  a-circumflex + quote/dash family (was an e2-lead char: em-dash, arrows)
//   c3 a2 c2 …  a-circumflex + raw continuation (same family, other windows)
//   c3 83 …     A-tilde (was a c3-lead char: accented latin letters)
const MOJIBAKE_SIGNATURES = [
  Buffer.from([0xc3, 0x82, 0xc2]),
  Buffer.from([0xc3, 0xa2, 0xe2]),
  Buffer.from([0xc3, 0xa2, 0xc2]),
  Buffer.from([0xc3, 0x83]),
];

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const EXTENSIONS = new Set(['.ts', '.tsx']);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

describe('source encoding guard', () => {
  const files = [...walk(SRC_ROOT)];

  it('scans a sane number of source files', () => {
    // If this ever reports near-zero, the walker is broken, not the codebase clean.
    expect(files.length).toBeGreaterThan(100);
  });

  it('every source file is valid UTF-8', () => {
    const invalid: string[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const file of files) {
      try {
        decoder.decode(fs.readFileSync(file));
      } catch {
        invalid.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(invalid).toEqual([]);
  });

  it('no source file contains double-encoding signatures', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const data = fs.readFileSync(file);
      if (MOJIBAKE_SIGNATURES.some((sig) => data.includes(sig))) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
