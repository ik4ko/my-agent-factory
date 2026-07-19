import { dispatchAgentStream, type AgentDispatchInput } from '@/app/actions/agent-dispatcher';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => ({})) as AgentDispatchInput;
  return dispatchAgentStream(input);
}
