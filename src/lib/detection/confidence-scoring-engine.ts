import { createClient } from '@supabase/supabase-js';

export type DetectionEventType = 
  | 'INITIAL_SCRAPE_MISSING'
  | 'CONSECUTIVE_MISSING'
  | 'COMMISSION_CONFIRMS_MISSING'
  | 'MARX_CONFIRMS_CHANGE';

export interface ConfidenceResult {
  C: number;
  status: string;
  shouldAlert: boolean;
  shouldSendSMS: boolean;
  isNewAlert: boolean;
  threshold: number;
}

export interface DecayResult {
  hadActiveDetection: boolean;
  resolutionType?: string;
  notifyBroker?: boolean;
  previousConfidence?: number;
}

export interface FeedbackResult {
  thresholdChanged: boolean;
  newThreshold?: number;
  platformWideIssue?: boolean;
  domRemappingQueued?: boolean;
}

// In a real app we'd get these from env, for tests/service we assume admin
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sxqdjilabbmjobjpwwst.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export class ConfidenceScoringEngine {
  private supabase = getSupabase();

  async computeConfidence(params: {
    bobMemberId: string;
    carrier: string;
    brokerId: string;
    agencyId: string;
    detectionEvent: DetectionEventType;
    syncId: string;
  }): Promise<ConfidenceResult> {
    const { bobMemberId, carrier, brokerId, agencyId, detectionEvent, syncId } = params;

    // 1. Fetch or create member_detection_log
    let { data: log, error: fetchErr } = await this.supabase
      .from('member_detection_log')
      .select('*')
      .eq('broker_id', brokerId)
      .eq('carrier', carrier)
      .eq('bob_member_id', bobMemberId)
      .maybeSingle();

    if (!log) {
      const { data: newLog, error: insErr } = await this.supabase
        .from('member_detection_log')
        .insert({
          broker_id: brokerId,
          carrier,
          bob_member_id: bobMemberId,
          agency_id: agencyId,
        })
        .select('*')
        .single();
      
      if (insErr) throw insErr;
      log = newLog;
    }

    // Default values if missing
    let components = log.score_components || {
      initial_scrape: 0, second_consecutive: 0, third_consecutive: 0,
      commission_match: 0, marx_lookup: 0, decay_applied: 0
    };
    let consecutiveCount = log.consecutive_missing_count || 0;
    let firstDetectedAt = log.first_detected_at;

    // 2. Apply points based on event type
    switch (detectionEvent) {
      case 'INITIAL_SCRAPE_MISSING':
        if (consecutiveCount === 0) {
          components.initial_scrape = 40;
          firstDetectedAt = new Date().toISOString();
          consecutiveCount = 1;
        }
        break;
      case 'CONSECUTIVE_MISSING':
        consecutiveCount += 1;
        if (consecutiveCount === 2) components.second_consecutive = 20;
        if (consecutiveCount === 3) components.third_consecutive = 15;
        break;
      case 'COMMISSION_CONFIRMS_MISSING':
        if (components.commission_match === 0) {
          components.commission_match = 25;
        }
        break;
      case 'MARX_CONFIRMS_CHANGE':
        if (components.marx_lookup === 0) {
          components.marx_lookup = 30;
        }
        break;
    }

    // 3. Compute raw score
    const rawScore = 
      (components.initial_scrape || 0) +
      (components.second_consecutive || 0) +
      (components.third_consecutive || 0) +
      (components.commission_match || 0) +
      (components.marx_lookup || 0) +
      (components.decay_applied || 0);

    // 4. Apply ceiling
    const C = Math.min(rawScore, 100);

    // 5. Fetch carrier threshold
    const { data: fpData } = await this.supabase
      .from('carrier_false_positive_tracker')
      .select('current_alert_threshold')
      .eq('carrier', carrier)
      .eq('agency_id', agencyId)
      .maybeSingle();
      
    const threshold = fpData?.current_alert_threshold ?? 70;

    // 6. Determine status
    let status = 'MONITORING';
    if (C >= 100) status = 'CONFIRMED';
    else if (C >= 85 && C <= 99) status = 'HIGH_CONFIDENCE';
    else if (C >= threshold && C < 85) status = 'ALERT_SENT';
    else if (C >= 60 && C <= 69) status = 'PENDING';
    else if (C >= 40 && C <= 59) status = 'WATCHLIST';

    // 7. Update member_detection_log
    const alertTriggeredAt = 
      (status === 'ALERT_SENT' && !log.alert_triggered_at) 
        ? new Date().toISOString() 
        : log.alert_triggered_at;

    await this.supabase
      .from('member_detection_log')
      .update({
        confidence_score: C,
        score_components: components,
        consecutive_missing_count: consecutiveCount,
        current_status: status,
        first_detected_at: firstDetectedAt,
        last_confirmed_missing_at: new Date().toISOString(),
        alert_triggered_at: alertTriggeredAt,
        alert_threshold_at_trigger: alertTriggeredAt && !log.alert_triggered_at ? threshold : log.alert_threshold_at_trigger
      })
      .eq('id', log.id);

    const shouldAlert = (status === 'ALERT_SENT' || status === 'HIGH_CONFIDENCE' || status === 'CONFIRMED');
    const isNewAlert = shouldAlert && !log.alert_triggered_at;
    const shouldSendSMS = status === 'HIGH_CONFIDENCE' || status === 'CONFIRMED';

    return {
      C, status, shouldAlert, shouldSendSMS, isNewAlert, threshold
    };
  }

  async applyConfidenceDecay(params: {
    bobMemberId: string;
    carrier: string;
    brokerId: string;
    agencyId: string;
  }): Promise<DecayResult> {
    const { bobMemberId, carrier, brokerId, agencyId } = params;

    const { data: log } = await this.supabase
      .from('member_detection_log')
      .select('*')
      .eq('broker_id', brokerId)
      .eq('carrier', carrier)
      .eq('bob_member_id', bobMemberId)
      .not('current_status', 'in', '("RESOLVED_FALSE_POSITIVE","RESOLVED_CONFIRMED_SWITCH")')
      .maybeSingle();

    if (!log) return { hadActiveDetection: false };

    const snapshot = { ...log };
    const resolutionType = !log.alert_triggered_at 
      ? 'SILENT_FALSE_POSITIVE' 
      : 'NOTIFIED_FALSE_POSITIVE';
    const notifyBroker = !!log.alert_triggered_at;

    await this.supabase
      .from('member_detection_log')
      .update({
        confidence_score: 0,
        score_components: {
          initial_scrape: 0, second_consecutive: 0, third_consecutive: 0,
          commission_match: 0, marx_lookup: 0, decay_applied: 0
        },
        consecutive_missing_count: 0,
        current_status: 'RESOLVED_FALSE_POSITIVE',
        last_seen_on_roster_at: new Date().toISOString()
      })
      .eq('id', log.id);

    if (log.switch_alert_id) {
      await this.supabase
        .from('switch_alerts')
        .update({
          status: 'dismissed',
          resolution: 'false_positive_auto_resolved',
          resolved_at: new Date().toISOString()
        })
        .eq('id', log.switch_alert_id);
    }

    await this.supabase
      .from('book_of_business')
      .update({
        verification_status: 'verified',
        status: 'active',
        last_verified_at: new Date().toISOString()
      })
      .eq('id', bobMemberId);

    await this.incrementFalsePositiveTracker(carrier, agencyId, 'auto_decay');

    await this.supabase
      .from('detection_audit_log')
      .insert({
        agency_id: agencyId,
        event_type: 'CONFIDENCE_DECAY_FULL_RESET',
        alert_id: log.switch_alert_id,
        broker_id: brokerId,
        carrier,
        confidence_before: snapshot.confidence_score,
        confidence_after: 0,
        metadata: snapshot
      });

    return { 
      hadActiveDetection: true, 
      resolutionType, 
      notifyBroker,
      previousConfidence: snapshot.confidence_score
    };
  }

  async processFalseAlarmFeedback(params: {
    alertId: string;
    brokerId: string;
    agencyId: string;
    carrier: string;
  }): Promise<FeedbackResult> {
    const { alertId, brokerId, agencyId, carrier } = params;

    // 1. Fetch alert and verify it exists
    const { data: alert } = await this.supabase
      .from('switch_alerts')
      .select('bob_member_id')
      .eq('id', alertId)
      .single();

    if (!alert) throw new Error('Alert not found');

    // 2. Update switch_alerts
    await this.supabase
      .from('switch_alerts')
      .update({
        status: 'dismissed',
        resolution: 'broker_marked_false_alarm',
        resolved_by: brokerId,
        resolved_at: new Date().toISOString()
      })
      .eq('id', alertId);

    // 3/4. Update book_of_business
    await this.supabase
      .from('book_of_business')
      .update({
        verification_status: 'verified',
        status: 'active',
        last_verified_at: new Date().toISOString()
      })
      .eq('id', alert.bob_member_id);

    // 5. Update member_detection_log
    const { data: logUpdate } = await this.supabase
      .from('member_detection_log')
      .update({
        current_status: 'RESOLVED_FALSE_POSITIVE',
        confidence_score: 0,
        score_components: {
          initial_scrape: 0, second_consecutive: 0, third_consecutive: 0,
          commission_match: 0, marx_lookup: 0, decay_applied: 0
        },
        consecutive_missing_count: 0
      })
      .eq('switch_alert_id', alertId)
      .select()
      .single();

    // 6. Increment False Positive Tracker
    const { newThreshold, thresholdChanged, platformWideIssue } = 
      await this.incrementFalsePositiveTracker(carrier, agencyId, 'broker_manual_feedback');

    // 8. Insert audit log
    await this.supabase
      .from('detection_audit_log')
      .insert({
        agency_id: agencyId,
        event_type: 'FALSE_ALARM_FEEDBACK',
        alert_id: alertId,
        broker_id: brokerId,
        carrier,
        threshold_after: newThreshold,
        metadata: { source: 'broker_manual_feedback' }
      });

    return {
      thresholdChanged,
      newThreshold,
      platformWideIssue,
      domRemappingQueued: platformWideIssue
    };
  }

  private async incrementFalsePositiveTracker(carrier: string, agencyId: string, source: string) {
    // 1. Fetch current tracker
    const { data: current } = await this.supabase
      .from('carrier_false_positive_tracker')
      .select('*')
      .eq('carrier', carrier)
      .eq('agency_id', agencyId)
      .maybeSingle();

    let fp7d = (current?.false_positive_count_7d || 0) + 1;
    let fp30d = (current?.false_positive_count_30d || 0) + 1;
    let total = (current?.total_false_positives || 0) + 1;
    let threshold = current?.current_alert_threshold || 70;
    
    let thresholdChanged = false;
    
    if (source === 'broker_manual_feedback') {
      if (fp7d >= 5 && threshold === 75) {
        threshold = 85;
        thresholdChanged = true;
      } else if (fp7d >= 3 && threshold === 70) {
        threshold = 75;
        thresholdChanged = true;
      }
    }

    if (!current) {
      await this.supabase
        .from('carrier_false_positive_tracker')
        .insert({
          carrier,
          agency_id: agencyId,
          false_positive_count_7d: fp7d,
          false_positive_count_30d: fp30d,
          total_false_positives: total,
          current_alert_threshold: threshold,
          last_false_positive_at: new Date().toISOString(),
          threshold_last_adjusted: thresholdChanged ? new Date().toISOString() : null
        });
    } else {
      await this.supabase
        .from('carrier_false_positive_tracker')
        .update({
          false_positive_count_7d: fp7d,
          false_positive_count_30d: fp30d,
          total_false_positives: total,
          current_alert_threshold: threshold,
          last_false_positive_at: new Date().toISOString(),
          threshold_last_adjusted: thresholdChanged ? new Date().toISOString() : current.threshold_last_adjusted
        })
        .eq('id', current.id);
    }

    // Check platform wide
    // For simplicity of tests without complex time queries on distinct agencies, 
    // let's do a simple count of distinct agencies that had a false positive in the tracker 
    // with recent updates, but since we are UPSERTing, we just count how many trackers exist for carrier with fp7d > 0.
    const { count } = await this.supabase
      .from('carrier_false_positive_tracker')
      .select('agency_id', { count: 'exact', head: true })
      .eq('carrier', carrier)
      .gt('false_positive_count_7d', 0);

    let platformWideIssue = false;
    if (count && count >= 3) {
      platformWideIssue = true;
      await this.supabase
        .from('carrier_false_positive_tracker')
        .update({ platform_wide: true })
        .eq('carrier', carrier);
    }

    return { newThreshold: threshold, thresholdChanged, platformWideIssue };
  }
}
