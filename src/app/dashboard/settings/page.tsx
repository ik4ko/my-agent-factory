import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';

export default function SettingsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Settings"
      icon="settings"
      accent="text-neon-cyan"
      blurb="Configuration and connections. Brains: Claude (CEO, Anthropic) is live; Codex and Hermes route through OpenRouter and need credits to become distinct. Email sends from your Gmail once GMAIL_USER and GMAIL_APP_PASSWORD are set and nodemailer is installed. Keys live in your .env — not here."
    />
  );
}
