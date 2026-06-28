import { Badge } from "@/components/ui/badge"
import { Scale, AlertTriangle, CreditCard, Ban, FileText, RefreshCw } from "lucide-react"
import Link from "next/link"
import { MarketingShell } from "@/components/marketing-shell"

export const metadata = {
  title: "Terms of Service | AegisSage",
  description: "AegisSage platform terms of service, commitment policies, and usage agreement.",
}

const SECTIONS = [
  {
    icon: FileText,
    title: "Acceptance of Terms",
    content: `By creating an account on AegisSage, you agree to be bound by these Terms of Service ("Terms"), our Privacy Policy, and — for agency accounts — the executed Business Associate Agreement. These Terms constitute the entire agreement between you and AegisSage Intelligence Inc. ("AegisSage", "we", "us") with respect to the platform. If you do not agree to these Terms, you may not use the platform. Use by licensed Medicare agents only. You represent and warrant that you hold an active insurance producer license in all jurisdictions in which you operate.`,
  },
  {
    icon: CreditCard,
    title: "Subscription, Billing & Annual Commitment",
    content: `AegisSage offers two subscription tiers: the Independent Broker Plan ($149/month, billed monthly or $119/month billed annually) and the Agency Plan ($749/month base + $49/broker seat/month, billed annually). Agency Plan subscriptions require a minimum 12-month commitment and are billed upfront for the annual term or on a Net-30 invoice schedule by arrangement. Monthly billing is available for the Broker Plan only. All prices are in USD and subject to change with 30 days' written notice. Annual commitments are non-cancellable mid-term except in the event of a material breach by AegisSage that remains uncured for 30 days following written notice.`,
  },
  {
    icon: Ban,
    title: "Cancellation & Refund Policy",
    content: `Monthly Broker Plan subscribers may cancel at any time. Cancellations take effect at the end of the current billing period. No prorated refunds are issued for partial months. Annual Agency Plan subscribers who cancel mid-term forfeit the remainder of their prepaid annual term and are not entitled to a refund for unused months. AegisSage may, at its sole discretion, offer a prorated credit toward a future term in extenuating circumstances. All cancellation requests must be submitted in writing to billing@aegissage.com. Cancellation does not relieve you of any outstanding payment obligations.`,
  },
  {
    icon: Scale,
    title: "Permitted Use & Agent Responsibilities",
    content: `AegisSage is licensed for use by the individual agent or agency team named in the account registration. You may not: (a) share login credentials with unlicensed persons; (b) use the platform to access beneficiary data you are not the Agent of Record for; (c) reverse-engineer, scrape, or attempt to extract the underlying data models or algorithms; (d) upload data you do not have legal authorization to process; or (e) use the platform in any way that violates HIPAA, state insurance regulations, or CMS Marketing Guidelines. You are solely responsible for ensuring that your use of MBI data and PHI complies with all applicable law. AegisSage is a software tool, not a compliance advisor.`,
  },
  {
    icon: AlertTriangle,
    title: "Limitation of Liability & Disclaimers",
    content: `AegisSage provides carrier roster monitoring and retention tooling on a best-efforts basis. We do not guarantee that all plan switches will be detected, that all alerts will be actionable, or that use of the platform will result in any specific business outcome. The platform is provided "as-is" and "as-available." AegisSage's total liability for any claim arising under these Terms shall not exceed the fees paid by you in the 12 months preceding the claim. AegisSage is not affiliated with, endorsed by, or connected to the Centers for Medicare & Medicaid Services (CMS) or any government agency. Roster data reflects carrier-reported information and may not reflect real-time CMS enrollment status.`,
  },
  {
    icon: RefreshCw,
    title: "Modifications to the Platform & Terms",
    content: `AegisSage reserves the right to modify, update, or discontinue any feature of the platform at any time with reasonable notice. Material changes to these Terms will be communicated via email at least 15 days in advance. Continued use of the platform following notice of changes constitutes acceptance of the revised Terms. For Agency Plan customers, material pricing changes do not take effect until the beginning of your next annual renewal term.`,
  },
]

export default function TermsPage() {
  return (
    <MarketingShell>
      <main className="max-w-3xl mx-auto py-24 px-8 space-y-12">

        <div className="space-y-4">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px]">
            Effective: January 1, 2026 · Last Updated: May 28, 2026
          </Badge>
          <h1 className="text-5xl font-black tracking-tighter uppercase">Terms of Service</h1>
          <p className="text-lg font-bold text-muted-foreground uppercase tracking-tight leading-relaxed">
            Legal agreement governing your use of the AegisSage Medicare Retention Platform. Please read carefully
            before activating your account.
          </p>
        </div>

        {/* Annual commitment callout */}
        <div className="p-6 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black uppercase tracking-tight text-amber-900">Agency Plans Require Annual Commitment</p>
            <p className="text-sm text-amber-700 font-medium">
              Agency subscriptions are billed on an annual basis and are non-cancellable mid-term. Please review
              Sections 2 and 3 carefully before completing your Agency onboarding.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map((s, i) => (
            <section key={i} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <s.icon className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black uppercase tracking-tight">{i + 1}. {s.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground font-medium leading-relaxed pl-11">{s.content}</p>
            </section>
          ))}
        </div>

        {/* Contact */}
        <div className="p-6 rounded-3xl bg-muted/30 border border-border space-y-3">
          <p className="text-sm font-black uppercase tracking-tight">Legal &amp; Billing Inquiries</p>
          <div className="flex flex-col gap-1">
            <a href="mailto:legal@aegissage.com" className="font-black text-primary hover:text-primary/80 transition-colors text-sm">
              legal@aegissage.com
            </a>
            <a href="mailto:billing@aegissage.com" className="font-black text-primary hover:text-primary/80 transition-colors text-sm">
              billing@aegissage.com
            </a>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            AegisSage Intelligence Inc. · Governing Law: State of Texas · Venue: Travis County, TX
          </p>
        </div>

        {/* Related pages — canonical links only */}
        <div className="flex flex-wrap gap-4 pt-4">
          <Link href="/privacy" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">
            Privacy Policy →
          </Link>
          <Link href="/security-compliance" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">
            Security &amp; Compliance →
          </Link>
          <Link href="/baa" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">
            BAA Agreement →
          </Link>
        </div>

      </main>
    </MarketingShell>
  )
}
