import { AgentChat } from '@/components/dashboard/agent-chat';

/**
 * /dashboard/chat — deep-dive conversation surface. Same AgentChat widget
 * the Control Room embeds as a panel; this route is the full-screen
 * transition target for longer sessions with an individual brain.
 */
export default function ChatPage() {
  return (
    <div className="h-full">
      <AgentChat variant="full" />
    </div>
  );
}
