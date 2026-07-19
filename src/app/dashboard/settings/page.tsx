import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { SettingsClient, type EnvFlag } from '@/components/dashboard/settings-client';

// Presence booleans only — computed server-side; values never leave the server.
function envFlags(): EnvFlag[] {
  const set = (name: string) => Boolean(process.env[name]?.trim());
  return [
    { label: 'OpenRouter (9-agent matrix)', configured: set('OPENROUTER_API_KEY'), hint: 'OPENROUTER_API_KEY — powers the dispatchAgent brain matrix' },
    { label: 'Anthropic (Claude direct)', configured: set('ANTHROPIC_API_KEY'), hint: 'ANTHROPIC_API_KEY — direct Claude access outside OpenRouter' },
    { label: 'Supabase service role', configured: set('SUPABASE_SERVICE_ROLE_KEY'), hint: 'SUPABASE_SERVICE_ROLE_KEY — server-side DB access for workers' },
    { label: 'Dashboard auth', configured: set('DASHBOARD_PASSWORD'), hint: 'DASHBOARD_PASSWORD — operator session gate' },
    { label: 'Simulation control PIN', configured: set('OPERATOR_PIN'), hint: 'OPERATOR_PIN — defense-in-depth for paper-simulation arm/halt/stop controls' },
    { label: 'Gmail sender', configured: set('GMAIL_USER') && set('GMAIL_APP_PASSWORD'), hint: 'GMAIL_USER + GMAIL_APP_PASSWORD — outbound email from the Personal workspace' },
    { label: 'Finnhub quotes', configured: set('FINNHUB_API_KEY'), hint: 'FINNHUB_API_KEY — live quote polling for the Trading Room' },
    { label: 'Alpaca market stream', configured: set('ALPACA_API_KEY_ID') || set('APCA_API_KEY_ID') || set('ALPACA_API_KEY'), hint: 'ALPACA_API_KEY_ID + secret — IEX tick stream for the chart (mock fallback without it)' },
  ];
}

export default function SettingsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Settings"
      icon="settings"
      accent="text-neon-cyan"
      blurb="Configuration and connections. The brain matrix below is the live 9-agent OpenRouter routing table used by the dispatchAgent server action — test any lane with one metered call. Keys live in .env.local; this page only ever shows whether they are set."
    >
      <SettingsClient envFlags={envFlags()} />
    </WorkspaceScaffold>
  );
}
