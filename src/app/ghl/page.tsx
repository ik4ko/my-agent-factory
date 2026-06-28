/**
 * /ghl — deprecated standalone page.
 *
 * GHL OAuth connect and contact sync are now embedded inside the unified
 * data import interface at /dashboard/churn/upload.
 *
 * After a successful OAuth callback the user is routed directly to their
 * Book of Business (/dashboard/book?import=connected) where the sync
 * result is surfaced as a toast notification.
 */
import { redirect } from 'next/navigation'

export default function GHLPageRedirect() {
  redirect('/dashboard/churn/upload')
}
