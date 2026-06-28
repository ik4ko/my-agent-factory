"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Logo } from "@/components/logo"
import {
  ShieldCheck, Lock, Clock, FileSignature, Download,
  ArrowLeft, CheckCircle2, ExternalLink, Scale, Globe, AlertTriangle,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Section anchor IDs referenced by links across the app:
//   /compliance#encryption
//   /compliance#baa
//   /compliance#retention
//   /compliance#terms
//   /compliance#privacy
// ---------------------------------------------------------------------------

const LAST_UPDATED = "May 5, 2026"

export default function CompliancePage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/10">

      {/* -- Sticky header --------------------------------------------------- */}
      <header className="h-20 border-b border-border/50 px-8 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-50">
        <Link href="/" className="flex items-center gap-3">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <nav className="hidden md:flex items-center gap-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <a href="#encryption" className="hover:text-primary transition-colors">Encryption</a>
            <a href="#baa"        className="hover:text-primary transition-colors">BAA</a>
            <a href="#retention"  className="hover:text-primary transition-colors">Retention</a>
            <a href="#terms"      className="hover:text-primary transition-colors">Terms</a>
            <a href="#privacy"    className="hover:text-primary transition-colors">Privacy</a>
          </nav>
          <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest">
            <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-20 px-8 space-y-24 pb-32">

        {/* -- Hero ------------------------------------------------------------ */}
        <section className="space-y-6 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-[2rem] bg-primary/10 flex items-center justify-center text-primary shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px]">
            CMS 2026 Compliance Standard
          </Badge>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            Security & Compliance Statement
          </h1>
          <p className="text-lg font-bold text-muted-foreground uppercase tracking-tight max-w-2xl mx-auto">
            AegisSage is engineered for HIPAA-aligned Medicare broker operations.
            This statement details our data protection practices, legal obligations,
            and broker responsibilities.
          </p>
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
            Last updated: {LAST_UPDATED}
          </p>
        </section>

        {/* -- Compliance badges row ------------------------------------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: Lock,          label: "AES-256-GCM",         sub: "Data Encryption at Rest"          },
            { icon: FileSignature, label: "HIPAA BAA",            sub: "Business Associate Agreement"     },
            { icon: Clock,         label: "10-Year Retention",    sub: "CMS Mandated Record Keeping"      },
          ].map(({ icon: Icon, label, sub }) => (
            <Card key={label} className="rounded-3xl border-none shadow-sm bg-muted/20 text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mx-auto">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-tight text-foreground">{label}</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">{sub}</p>
              </div>
            </Card>
          ))}
        </div>

        <Separator className="opacity-30" />

        {/* -- Section 01: Data Encryption ------------------------------------ */}
        <section id="encryption" className="space-y-8 scroll-mt-24">
          <div className="flex items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-1">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">
                01. Data Encryption (AES-256-GCM)
              </h2>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide mt-1">
                Field-Level & At-Rest Protection
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                title: "Field-Level Encryption",
                body: "Protected Health Information (PHI) fields -- including Medicare Beneficiary Identifiers (MBI), dates of birth, and phone numbers -- are encrypted individually using AES-256-GCM with unique IVs per field. Keys are derived via PBKDF2 (100,000 iterations, SHA-256) from a master secret stored in Firebase Secret Manager. This means each field requires its own decryption operation.",
              },
              {
                title: "Encryption at Rest",
                body: "All Firestore databases are encrypted at rest using Google-managed AES-256 keys. PHI blobs stored in Google Cloud Storage are protected with Customer-Managed Encryption Keys (CMEK). No plaintext PHI is ever written to any persistent storage layer.",
              },
              {
                title: "In-Transit Encryption",
                body: "All client-to-server communication is protected by TLS 1.3. Webhook payloads from CRM integrations (GoHighLevel, EnrollHere) are verified via HMAC-SHA256 signature on the x-webhook-signature header before processing begins.",
              },
              {
                title: "Minimum Necessary Standard",
                body: "Per HIPAA §164.514(d), AegisSage applies the minimum necessary standard to all PHI access. Operational metadata (plan IDs, retention scores, status flags) is stored separately from PHI. AI risk-scoring flows operate exclusively on non-PHI operational data.",
              },
            ].map(({ title, body }) => (
              <Card key={title} className="rounded-3xl border border-border/50 bg-card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <h3 className="text-sm font-black uppercase tracking-tight">{title}</h3>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="opacity-30" />

        {/* -- Section 02: HIPAA BAA ------------------------------------------- */}
        <section id="baa" className="space-y-8 scroll-mt-24">
          <div className="flex items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0 mt-1">
              <FileSignature className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">
                02. HIPAA BAA Availability
              </h2>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide mt-1">
                Business Associate Agreement -- Required for Platform Access
              </p>
            </div>
          </div>

          <Card className="rounded-3xl border border-border/50 bg-card overflow-hidden">
            <CardContent className="p-8 space-y-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                AegisSage functions as a <strong className="text-foreground">Business Associate</strong> under
                HIPAA (45 CFR §160.103) when processing Protected Health Information on behalf of Covered
                Entities (Medicare insurance brokers and agencies). All agencies accessing PHI functionality
                must have an executed Business Associate Agreement on file before platform access is granted.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                {[
                  { label: "Safeguard PHI",          desc: "Administrative, physical, and technical safeguards per §164.310-164.312" },
                  { label: "Report Breaches",         desc: "Notify covered entity within 60 days of PHI breach discovery per §164.410" },
                  { label: "Subcontractor BAAs",      desc: "Flow-down BAA obligations to all subprocessors handling PHI" },
                ].map(({ label, desc }) => (
                  <div key={label} className="p-4 rounded-2xl bg-muted/30 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <p className="text-[10px] font-black uppercase tracking-widest">{label}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">{desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  className="rounded-2xl font-black uppercase text-[10px] tracking-widest bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 h-12"
                  asChild
                >
                  {/* Place the actual PDF at public/BAA_Template.pdf before deploying */}
                  <a href="/BAA_Template.pdf" target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Download BAA Template
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl font-black uppercase text-[10px] tracking-widest border-primary/20 text-primary h-12"
                  asChild
                >
                  <Link href="/docs/baa-agreement">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Review BAA Agreement
                  </Link>
                </Button>
              </div>

              <p className="text-[9px] text-muted-foreground font-medium border-t border-border pt-4">
                Agencies that have not executed a BAA will not be granted access to PHI-adjacent features,
                including the Integrity Engine, CSV ingestion, and Blue Button 2.0 integration. Contact
                compliance@aegissage.com to initiate the BAA execution process.
              </p>
            </CardContent>
          </Card>
        </section>

        <Separator className="opacity-30" />

        {/* -- Section 03: 10-Year Record Retention --------------------------- */}
        <section id="retention" className="space-y-8 scroll-mt-24">
          <div className="flex items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-1">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">
                03. CMS 10-Year Record Retention Policy
              </h2>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide mt-1">
                TPMO Regulation -- 42 CFR §422.2274 & §423.2274
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Card className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-sm font-black uppercase tracking-tight text-amber-700 dark:text-amber-400">
                  Mandatory for All Licensed TPMOs
                </h3>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Under CMS final rules effective 2024 (and reinforced for 2026), all Third-Party Marketing
                Organizations (TPMOs) must retain records of Medicare beneficiary interactions for a minimum
                of <strong className="text-foreground">10 years</strong>. This includes call recordings, Scope
                of Appointment forms, enrollment documents, and all marketing materials.
              </p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  title: "Call Recordings",
                  body:  "All sales calls must be recorded and retained for 10 years. AegisSage integrates with Maya AI Voice to auto-archive and timestamp each call with the associated member record.",
                  rule:  "42 CFR §422.2274(c)(1)",
                },
                {
                  title: "Scope of Appointment (SOA)",
                  body:  "SOA forms must be completed 48 hours before an enrollment meeting and retained for 10 years. AegisSage generates, digitally signs, and cryptographically hashes all SOA documents.",
                  rule:  "42 CFR §422.2262",
                },
                {
                  title: "Marketing Materials",
                  body:  "All marketing materials, including digital assets and CRM campaigns, must be pre-approved by the carrier and retained for 10 years. AegisSage logs all outreach events in an immutable audit trail.",
                  rule:  "42 CFR §422.2274(b)",
                },
              ].map(({ title, body, rule }) => (
                <Card key={title} className="rounded-3xl border border-border/50 bg-card p-6 space-y-3">
                  <h3 className="text-sm font-black uppercase tracking-tight">{title}</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{body}</p>
                  <p className="text-[9px] font-mono text-primary/60">{rule}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <Separator className="opacity-30" />

        {/* -- Section 04: Terms of Service ----------------------------------- */}
        <section id="terms" className="space-y-8 scroll-mt-24">
          <div className="flex items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-1">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <Badge className="bg-primary/10 text-primary border-primary/20 px-3 py-1 font-black uppercase tracking-widest text-[9px] mb-2">
                Service Agreement
              </Badge>
              <h2 className="text-2xl font-black uppercase tracking-tight">Terms of Service</h2>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide mt-1">
                Legal framework for the AegisSage Medicare Retention Platform.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {[
              {
                num: "01",
                title: "Licensure Requirement",
                body: "By registering, users represent that they are licensed Medicare insurance agents in good standing with a valid National Producer Number (NPN) on file with the National Insurance Producer Registry (NIPR). AegisSage reserves the right to verify licensure at any time and suspend accounts where licensure cannot be confirmed.",
              },
              {
                num: "02",
                title: "Agency Responsibility & CMS Compliance",
                body: "Agencies are solely responsible for ensuring that all AI-assisted outreach, VCC fax submissions, SOA generation, and enrollment recommendations comply with applicable CMS regulations, carrier guidelines, and state insurance law. AegisSage provides tools -- the licensed broker retains full professional responsibility for client interactions.",
              },
              {
                num: "03",
                title: "TPMO Obligations",
                body: "By using the platform, all users agree to comply with CMS TPMO rules including: recording all sales calls and retaining recordings for 10 years; completing Scope of Appointment forms at least 48 hours before enrollment meetings; using only CMS-approved marketing language; and disclosing TPMO status to all beneficiaries at the point of first contact.",
              },
              {
                num: "04",
                title: "Subscription & Billing",
                body: "Plans are billed monthly or annually as selected at signup. Cancellations take effect at the end of the current billing cycle. No partial refunds are issued for unused time. All payment transactions are processed via our BAA-compliant payment processor using PCI-DSS Level 1 infrastructure.",
              },
              {
                num: "05",
                title: "BAA Requirement",
                body: "Access to PHI-adjacent features (Integrity Engine, CSV ingestion, Blue Button 2.0, member health records) is contingent upon the Agency having a signed Business Associate Agreement on file with AegisSage Intelligence Inc. Contact compliance@aegissage.com to initiate.",
              },
              {
                num: "06",
                title: "Prohibited Uses",
                body: "The platform may not be used to: (i) market non-Medicare insurance products without carrier authorization; (ii) access or export PHI for purposes beyond direct member care coordination; (iii) share platform access credentials with unlicensed individuals; (iv) circumvent CMS or NIPR oversight mechanisms; or (v) use AI-generated content in regulatory submissions without human review.",
              },
            ].map(({ num, title, body }) => (
              <Card key={num} className="rounded-3xl border border-border/50 bg-muted/10 p-8 space-y-3">
                <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-3">
                  <span className="text-primary/50 font-mono text-[10px]">{num}.</span>
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="opacity-30" />

        {/* -- Section 05: Privacy Policy -------------------------------------- */}
        <section id="privacy" className="space-y-8 scroll-mt-24">
          <div className="flex items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-1">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <Badge className="bg-primary/10 text-primary border-primary/20 px-3 py-1 font-black uppercase tracking-widest text-[9px] mb-2">
                Data Privacy
              </Badge>
              <h2 className="text-2xl font-black uppercase tracking-tight">Privacy Policy</h2>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide mt-1">
                How AegisSage collects, uses, and protects your data.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {[
              {
                num:   "01",
                title: "Data We Collect",
                body:  "We collect: (i) broker account information (name, email, NPN, phone, agency name); (ii) member operational metadata (plan IDs, enrollment periods, retention scores) -- no PHI in this layer; (iii) PHI provided for processing (MBI, DOB, phone) -- stored exclusively in the encrypted phi_vault and members collections; (iv) usage analytics (page views, feature interactions) in anonymized form.",
              },
              {
                num:   "02",
                title: "How We Use Your Data",
                body:  "Broker account data is used to authenticate users and enforce agency-level access controls. Member operational data powers AI risk scoring, switch detection, and retention recommendations. PHI is processed solely for the purpose of facilitating Medicare insurance broker services on behalf of the covered entity (your agency). We do not sell, rent, or share data with third parties for marketing purposes.",
              },
              {
                num:   "03",
                title: "Data Retention & Deletion",
                body:  "Account data is retained for the duration of the subscription plus 90 days post-cancellation. PHI is retained for the CMS-mandated 10-year period or longer if required by state law. Brokers may request PHI deletion via the Admin SDK right-of-erasure workflow; note that deletion requests may be subject to regulatory retention requirements that supersede the request.",
              },
              {
                num:   "04",
                title: "Cookies & Tracking",
                body:  "AegisSage uses only essential session cookies required for Firebase Authentication. No third-party advertising trackers, behavioral profiling cookies, or cross-site tracking pixels are deployed. Analytics data is collected via anonymized server-side event logging only.",
              },
              {
                num:   "05",
                title: "Your Rights",
                body:  "Brokers have the right to: access their account and agency data; correct inaccurate information; request data portability in JSON or CSV format; request deletion subject to retention requirements. For requests, contact privacy@aegissage.com. Responses will be provided within 30 days.",
              },
            ].map(({ num, title, body }) => (
              <Card key={num} className="rounded-3xl border border-border/50 bg-muted/10 p-8 space-y-3">
                <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-3">
                  <span className="text-primary/50 font-mono text-[10px]">{num}.</span>
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* -- Footer CTA ------------------------------------------------------ */}
        <div className="p-10 rounded-3xl border-2 border-dashed border-primary/20 bg-primary/5 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto text-primary">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-black text-foreground uppercase tracking-widest">
            Questions About Compliance?
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed font-medium max-w-md mx-auto">
            Our compliance team is available to assist with BAA execution, NIPR verification,
            CMS audit preparation, and regulatory questions.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button className="rounded-2xl font-black uppercase text-[10px] tracking-widest bg-primary hover:bg-primary/90 h-11" asChild>
              <a href="mailto:compliance@aegissage.com">
                Contact Compliance Team
              </a>
            </Button>
            <Button variant="outline" className="rounded-2xl font-black uppercase text-[10px] tracking-widest border-primary/20 text-primary h-11" asChild>
              <a href="/BAA_Template.pdf" target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Download BAA Template
              </a>
            </Button>
          </div>
        </div>
      </main>

      {/* -- Page footer ----------------------------------------------------- */}
      <footer className="border-t border-border/50 py-10 px-8 text-center space-y-3">
        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
          © {new Date().getFullYear()} AegisSage Intelligence Inc. · HIPAA Compliant · CMS TPMO Registered
        </p>
        <div className="flex justify-center gap-8 text-[9px] font-black text-muted-foreground uppercase tracking-widest">
          <a href="#terms"   className="hover:text-primary transition-colors">Terms</a>
          <a href="#privacy" className="hover:text-primary transition-colors">Privacy</a>
          <a href="#baa"     className="hover:text-primary transition-colors">BAA</a>
          <a href="mailto:compliance@aegissage.com" className="hover:text-primary transition-colors">compliance@aegissage.com</a>
        </div>
      </footer>
    </div>
  )
}
