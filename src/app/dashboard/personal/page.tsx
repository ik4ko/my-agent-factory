import { User } from 'lucide-react';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { EmailComposer } from '@/components/dashboard/email-composer';

export default function PersonalWorkspace() {
  return (
    <WorkspaceScaffold
      title="Personal"
      icon={User}
      accent="text-neon-orange"
      blurb="Your personal assistant surface. Compose and send email straight from your Gmail below — every send is logged to the outbound audit trail. Or ask Claude in Chat to draft and send one for you."
    >
      <EmailComposer />
    </WorkspaceScaffold>
  );
}
