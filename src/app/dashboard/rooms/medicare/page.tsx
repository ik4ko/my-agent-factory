import { TodayQueue } from '@/components/dashboard/medicare/today-queue';

/**
 * The room's default view is the work queue, not a summary.
 *
 * Opening a CRM to a dashboard of totals answers "how is the business doing?",
 * which is a question Eric can ask when he wants to. The question he has every
 * morning is "what needs me today", so that is what the room opens to.
 */
export default function MedicareTodayPage() {
  return <TodayQueue />;
}
