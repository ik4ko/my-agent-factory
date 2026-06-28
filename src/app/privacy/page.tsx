import { Shield, Lock, Database, Bell, FileCheck, Users, Mail } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export const metadata = {
  title: "Privacy Policy | AegisSage",
  description: "AegisSage HIPAA privacy policy — how we collect, store, and protect Medicare broker and member data.",
}

const SECTIONS = [
  {
    icon: Database,
    title: "What Data We Collect",
    content: [
      "Member data: full name, Medicare Beneficiary Identifier (MBI), and current plan information — submitted by licensed agents on behalf of their clients.",
      "Broker data: name, email address, and agency affiliation — collected at account registration.",
      "Usage data: session activity timestamps and audit log events generated during normal platform use.",
      "We do not collect data beyond what is necessary for plan switch detection, VCC/SSBCI form routing, and broker campaign delivery. We do not collect Social Security Numbers, dates of birth, or clinical diagnosis codes.",
    ],
  },
  {
    icon: Shield,
    title: "How Data Is Used",
    content: [
      "Plan switch monitoring: we run automated checks against CMS enrollment data to detect changes, disenrollments, or pending switches for your clients.",
      "Clinical form routing: VCC and SSBCI forms are routed to the appropriate member care teams on behalf of licensed agents.",
      "Broker-to-client campaign delivery: retention messages, wellness outreach, and renewal reminders are sent to your book of business on your schedule.",
      "Internal HIPAA audit logging: every PHI access event is recorded and retained to satisfy compliance obligations.",
      "Your data is never sold, never rented, and never used for third-party marketing or advertising under any circumstances.",
    ],
  },
  {
    icon: Lock,
    title: "How Data Is Stored and Protected",
    content: [
      "All data is encrypted at rest using AES-256 and in transit using TLS 1.2 or higher.",
      "Row-level security (RLS) is enforced at the database layer: each broker can access only the client records belonging to their own agency. Cross-agency data access is architecturally impossible.",
      "Audit logs are immutable and retained for a minimum of six years in compliance with HIPAA records retention requirements (45 CFR § 164.530(j)).",
      "Access to PHI is restricted to authenticated, authorized users only. AegisSage staff may access PHI solely when required to investigate a reported platform issue, under documented internal authorization, with all access logged.",
    ],
  },
  {
    icon: FileCheck,
    title: "Business Associate Agreements",
    content: [
      "AegisSage operates as a HIPAA Business Associate for all agency customers. A signed Business Associate Agreement (BAA) is required before any Protected Health Information may be processed through the platform.",
      "AegisSage maintains BAAs with all sub-processors that handle PHI. Sub-processors are reviewed annually and are vetted for HIPAA eligibility before any PHI is transmitted to them.",
      "A full list of sub-processors is available upon request at privacy@aegissage.com.",
    ],
  },
  {
    icon: Bell,
    title: "Breach Notification",
    content: [
      "Breaches affecting 500 or more individuals: affected individuals and the U.S. Department of Health and Human Services (HHS) will be notified within 60 days of discovery, in accordance with the HIPAA Breach Notification Rule (45 CFR §§ 164.400–414). Where required by state law, prominent media outlets in the affected area will also be notified.",
      "Smaller breaches affecting fewer than 500 individuals: logged internally and reported to HHS in our annual breach summary.",
      "All breach notifications will include: a description of what occurred, the types of PHI involved, steps individuals should take to protect themselves, and the steps AegisSage is taking to investigate and prevent recurrence.",
    ],
  },
  {
    icon: Users,
    title: "Your Rights",
    content: [
      "Licensed brokers may request deletion of their account and all associated data by contacting privacy@aegissage.com. We will respond within 30 days.",
      "Brokers may also request access to, correction of, or a machine-readable export of all data held about their account.",
      "Medicare members whose data is processed through the platform have rights under the HIPAA Privacy Rule (45 CFR Part 164, Subpart E), including the right to access and amend their PHI. Such requests must be coordinated with the licensed agent who submitted the data.",
      "Contact: privacy@aegissage.com for all privacy inquiries, data access requests, or BAA execution.",
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="max-w-3xl mx-auto py-20 px-8 space-y-14">

        {/* Header */}
        <div className="space-y-5">
          <Badge className="bg-primary/10 text-primary border-primary/20 font-black uppercase tracking-widest text-[10px] px-4 py-1.5">
            Privacy Policy
          </Badge>
          <h1 className="text-5xl font-black tracking-tighter uppercase text-white">Data &amp; Privacy</h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
            Effective: June 1, 2026 · Jurisdiction: United States
          </p>
          <p className="text-sm font-medium text-white/60 leading-relaxed max-w-2xl">
            AegisSage is a HIPAA-covered platform serving licensed Medicare insurance brokers. This policy governs how
            we collect, process, store, and protect data on behalf of brokers and their clients.
          </p>
        </div>

        {/* Never sell banner */}
        <div className="flex items-start gap-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black uppercase tracking-tight text-emerald-300">We Do Not Sell Your Data. Ever.</p>
            <p className="text-sm font-medium text-emerald-400/70 leading-relaxed">
              AegisSage does not sell, rent, license, or share any personal data or PHI with third parties for
              commercial purposes, advertising, or data brokerage.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-12">
          {SECTIONS.map((section, i) => (
            <section key={i} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <section.icon className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-lg font-black uppercase tracking-tight text-white">
                  {i + 1}. {section.title}
                </h2>
              </div>
              <ul className="space-y-3 pl-11">
                {section.content.map((item, j) => (
                  <li key={j} className="text-sm font-medium text-white/60 leading-relaxed flex items-start gap-2.5">
                    <span className="mt-2 w-1 h-1 rounded-full bg-primary/40 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Contact */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight text-white">Contact Our Privacy Team</h2>
          </div>
          <p className="text-sm font-medium text-white/50 pl-11">
            For all privacy inquiries, data access requests, breach reports, or BAA execution:
          </p>
          <a
            href="mailto:privacy@aegissage.com"
            className="pl-11 inline-block font-black text-primary hover:text-primary/80 transition-colors"
          >
            privacy@aegissage.com
          </a>
          <p className="text-xs font-medium text-white/30 pl-11">
            AegisSage Intelligence Inc. · HIPAA Business Associate Operations · Response within 30 days
          </p>
        </div>

      </main>
    </div>
  )
}
