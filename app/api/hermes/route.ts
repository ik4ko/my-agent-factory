import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { routeCommand } from '../../../lib/agent-routing';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://grtnjhwekvkyawacunde.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydG5qaHdla3ZheWN1bmRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjU4NjEyNywiZXhwIjoyMDk4MTYyMTI3fQ.LhY95C8MbsTK5Un_CPCClO5BMbK1hw05l0cqys0-B7we'
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const AGENT_LABELS: Record<string, string> = {
  'a1111111-1111-1111-1111-111111111111': 'Coder Agent',
  'a2222222-2222-2222-2222-222222222222': 'Research Agent',
  'a3333333-3333-3333-3333-333333333333': 'Browser Agent',
  'a4444444-4444-4444-4444-444444444444': 'Planner Agent',
};

async function routeWithClaude(prompt: string) {
  if (!anthropic) return null;

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    max_tokens: 400,
    temperature: 0.2,
    system: 'You are Hermes, a lightweight orchestration router for a multi-agent dashboard. Choose one agent and return JSON with agent_id, description, reasoning.',
    messages: [{ role: 'user', content: `Route this request: ${prompt}` }],
  });

  const textBlock = response.content.find((part: any) => part.type === 'text') as { text?: string } | undefined;
  const outputText = textBlock?.text?.trim() || '';
  if (!outputText) return null;

  try {
    return JSON.parse(outputText);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt text is required.' }, { status: 400 });
    }

    const claudeDecision = await routeWithClaude(prompt);
    const routingDecision = claudeDecision || routeCommand(prompt);
    const agentName = AGENT_LABELS[routingDecision.agent_id] || 'Planner Agent';

    await supabase.from('logs').insert({
      agent_id: null,
      message: `[HERMES_ORCHESTRATOR] Received command: ${prompt}`,
      level: 'info',
    });

    await supabase.from('agents').update({ status: 'running', current_task: routingDecision.description }).eq('id', routingDecision.agent_id);

    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .insert({
        agent_id: routingDecision.agent_id,
        description: routingDecision.description,
        status: 'pending',
      })
      .select()
      .single();

    if (taskError) throw taskError;

    await supabase.from('logs').insert({
      agent_id: routingDecision.agent_id,
      message: `[HERMES_ORCHESTRATOR] Routed to ${agentName}: ${routingDecision.reasoning}`,
      level: 'info',
    });

    return NextResponse.json({
      success: true,
      message: `Task routed to ${agentName}`,
      agent_name: agentName,
      task: taskData,
      provider: claudeDecision ? 'claude' : 'local',
    });
  } catch (error: any) {
    console.error('Hermes Error:', error);
    return NextResponse.json({ error: error.message || 'Internal orchestration error.' }, { status: 500 });
  }
}
