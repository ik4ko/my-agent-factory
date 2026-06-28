import { createClient } from '@supabase/supabase-js';

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sxqdjilabbmjobjpwwst.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export class AlertRoutingEngine {
  private supabase = getSupabase();

  async routeAlert(params: {
    alertId: string;
    agencyId: string;
    brokerId: string;
    tier: 'solo' | 'agency';
  }) {
    const { alertId, agencyId, brokerId, tier } = params;

    if (tier === 'solo') {
      // Route strictly to broker (no escalation timer)
      // This might involve sending email/SMS synchronously or queueing it
      // For this module, we just acknowledge the routing choice
      return { routedTo: 'broker_direct', escalationTimerCreated: false };
    }

    if (tier === 'agency') {
      // Need to route to AOR, notify CSR, write 4h countdown to escalation_timers
      // We assume the agency has an active CSR, we can look up CSR from brokers table or assume null
      const { data: broker } = await this.supabase
        .from('brokers')
        .select('csr_id')
        .eq('id', brokerId)
        .maybeSingle();

      const csrId = broker?.csr_id;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 4);

      const { error } = await this.supabase
        .from('escalation_timers')
        .insert({
          alert_id: alertId,
          agency_id: agencyId,
          broker_id: brokerId,
          csr_id: csrId,
          expires_at: expiresAt.toISOString(),
          status: 'open',
          escalation_level: 'csr_review'
        });

      if (error) console.error('Failed to create escalation timer:', error);

      return { routedTo: 'aor_and_csr', escalationTimerCreated: true, expiresAt };
    }
  }

  async executeExpiredEscalationTimers() {
    const now = new Date().toISOString();
    
    // Find open timers that have expired
    const { data: expiredTimers, error } = await this.supabase
      .from('escalation_timers')
      .select('*')
      .eq('status', 'open')
      .lt('expires_at', now);

    if (error) {
      console.error('Error fetching expired timers:', error);
      return { processed: 0, error };
    }

    if (!expiredTimers || expiredTimers.length === 0) {
      return { processed: 0 };
    }

    // Escalate to agency owners/admins
    for (const timer of expiredTimers) {
      // Find agency owners/admins
      // In a real scenario we'd fire an email/notification here
      
      await this.supabase
        .from('escalation_timers')
        .update({
          status: 'escalated',
          escalation_level: 'agency_admin',
          notes: '4-hour window expired, escalating to Agency Admins/Owners.'
        })
        .eq('id', timer.id);
    }

    return { processed: expiredTimers.length };
  }
}
