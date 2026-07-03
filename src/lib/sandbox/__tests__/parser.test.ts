import { parseToolCalls } from '@/lib/sandbox/parser';

describe('parseToolCalls', () => {
  it('parses a single fenced tool block', () => {
    const { calls, errors } = parseToolCalls('prose\n```tool\n{"tool":"view_file","path":"src/a.ts"}\n```\nmore');
    expect(errors).toEqual([]);
    expect(calls).toEqual([{ tool: 'view_file', path: 'src/a.ts' }]);
  });

  it('preserves write_file content with newlines and quotes', () => {
    const content = 'line1\nconst x = "y";\n';
    const block = '```tool\n' + JSON.stringify({ tool: 'write_file', path: 'out.ts', content }) + '\n```';
    const { calls } = parseToolCalls(block);
    expect(calls[0]).toEqual({ tool: 'write_file', path: 'out.ts', content });
  });

  it('parses multiple blocks and a JSON array block', () => {
    const t = [
      '```tool\n{"tool":"execute_command","command":"npm test"}\n```',
      '```tool\n[{"tool":"view_file","path":"a"},{"tool":"view_file","path":"b"}]\n```',
    ].join('\n');
    const { calls } = parseToolCalls(t);
    expect(calls.map((c) => c.tool)).toEqual(['execute_command', 'view_file', 'view_file']);
  });

  it('records errors for invalid JSON and unknown/malformed tools', () => {
    expect(parseToolCalls('```tool\n{not json}\n```').errors.length).toBe(1);
    expect(parseToolCalls('```tool\n{"tool":"drop_table"}\n```').errors[0]).toContain('unknown tool');
    expect(parseToolCalls('```tool\n{"tool":"view_file"}\n```').errors[0]).toContain('requires string');
  });

  it('ignores non-tool fences and empty input', () => {
    expect(parseToolCalls('```js\nconsole.log(1)\n```').calls).toEqual([]);
    expect(parseToolCalls('').calls).toEqual([]);
  });
});
