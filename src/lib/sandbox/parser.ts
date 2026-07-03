// Tool-call parser — extracts structured invocations from streaming agent
// text. Canonical form is a fenced ```tool block with one JSON object:
//
//   ```tool
//   { "tool": "execute_command", "command": "npm test" }
//   ```
//
// JSON keeps args (esp. write_file content with newlines/quotes) unambiguous;
// a regex-per-arg form can't survive real code payloads.
export type ToolCall =
  | { tool: 'view_file'; path: string }
  | { tool: 'write_file'; path: string; content: string }
  | { tool: 'execute_command'; command: string };

export interface ParseResult {
  calls: ToolCall[];
  errors: string[];
}

const FENCE = /```tool\s*\n([\s\S]*?)```/g;

function asToolCall(raw: unknown): ToolCall | string {
  if (typeof raw !== 'object' || raw === null) return 'not a JSON object';
  const o = raw as Record<string, unknown>;
  switch (o.tool) {
    case 'view_file':
      if (typeof o.path !== 'string') return 'view_file requires string "path"';
      return { tool: 'view_file', path: o.path };
    case 'write_file':
      if (typeof o.path !== 'string') return 'write_file requires string "path"';
      if (typeof o.content !== 'string') return 'write_file requires string "content"';
      return { tool: 'write_file', path: o.path, content: o.content };
    case 'execute_command':
      if (typeof o.command !== 'string') return 'execute_command requires string "command"';
      return { tool: 'execute_command', command: o.command };
    default:
      return `unknown tool: ${String(o.tool)}`;
  }
}

export function parseToolCalls(text: string): ParseResult {
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  if (typeof text !== 'string' || text.length === 0) return { calls, errors };

  for (const match of text.matchAll(FENCE)) {
    const body = match[1].trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      errors.push(`invalid JSON in tool block: ${body.slice(0, 80)}`);
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const result = asToolCall(item);
      if (typeof result === 'string') errors.push(result);
      else calls.push(result);
    }
  }
  return { calls, errors };
}
