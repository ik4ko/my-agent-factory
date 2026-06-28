import Link from "next/link"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Lock, Shield, Server, Eye, FileCheck, Key } from "lucide-react"

export const metadata = { title: "Security & Compliance | AegisSage", description: "AegisSage AES-256 encryption architecture, HIPAA compliance, and BAA information." }

const PILLARS = [
  {
    icon: Lock,
    title: "AES-256 Encryption at Rest",
    badge: "Data Storage",
    color: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    content: `All Protected Health Information stored within AegisSage — including Medicare Beneficiary Identifiers (MBIs), date-of-birth fields, and enrollment records — is encrypted at rest using AES-256-GCM. Encryption keys are managed using a hardware security module (HSM) and rotated on a 90-day schedule. Encryption is applied at the row level for PHI fields, meaning database administrators cannot read PHI values without proper key authorization.`,
  },
  {
    icon: Shield,
    title: "TLS 1.3 Encryption in Transit",
    badge: "Network Security",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    content: `All data transmitted between clients and AegisSage servers is encrypted using TLS 1.3. TLS 1.0 and 1.1 are explicitly disabled. Certificate pinning is enforced for the Chrome Extension API communication layer. All API endpoints use HTTPS exclusively — HTTP is redirected and blocked. Connections to third-party sub-processors (carrier roster APIs, email delivery) are verified via certificate authority validation.`,
  },
  {
    icon: Server,
    title: "Infrastructure & Hosting",
    badge: "AWS HIPAA-Eligible",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    content: `AegisSage's database infrastructure runs on Supabase hosted on AWS in the us-east-1 region, which is a HIPAA-eligible AWS service region. AWS maintains HITRUST CSF, SOC 1, SOC 2, and SOC 3 certifications. Application servers are hosted on Vercel's edge network; PHI is never transmitted to or processed by Vercel's infrastructure — all PHI operations run server-side within the AWS-backed database layer. Infrastructure access is restricted to named personnel via multi-factor authentication and zero-trust network policies.`,
  },
  {
    icon: Eye,
    title: "Access Controls & Audit Logging",
    badge: "RBAC + Logging",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    content: `AegisSage enforces role-based access control (RBAC) at both the application and database layers. Roles include Agency Owner, Agency Admin, Customer Service, Broker, and Solo Broker — each with distinct permission boundaries enforced via Row Level Security (RLS) policies in the database. All PHI access events (view, export, MBI reveal) are written to an immutable audit log with timestamp, user ID, and action type. Audit logs are retained for a minimum of six years in compliance with HIPAA requirements.`,
  },
  {
    icon: Key,
    title: "API Security & Extension Authentication",
    badge: "JWT + Hex Token Auth",
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
    content: `All AegisSage API endpoints are authenticated via Supabase JWT tokens validated server-side on every request. The Chrome Extension integration uses a separate 64-character hex API key scoped to the individual broker, rotated on demand, and stored in the browser's secure local storage (never in plaintext). Extension API keys do not grant access to PHI — they are scoped exclusively to triggering sync operations and reading non-sensitive enrollment status signals.`,
  },
  {
    icon: FileCheck,
    title: "Business Associate Agreements (BAAs)",
    badge: "HIPAA Required",
    color: "text-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
    content: `Business Associate Agreements are available upon request and required for all Agency Plan customers who will transmit or process Protected Health Information through the platform. Our standard BAA is modeled on the HHS model BAA template and covers all sub-processors with access to PHI. BAA execution is handled by our compliance team within 3 business days. Individual brokers using the platform for their own client records may request a BAA at any time. Contact compliance@aegissage.com to initiate the BAA process.`,
  },
]

export default function SecurityCompliancePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-20 border-b border-border/50 px-8 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-50">
        <Link href="/" className="flex items-center gap-3"><Logo /></Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
        </Button>
      </header>

      <main className="max-w-3xl mx-auto py-24 px-8 space-y-12">
        <div className="space-y-4">
          <Badge className="bg-violet-500/10 text-violet-700 border-violet-500/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px]">
            Enterprise Security Architecture
          </Badge>
          <h1 className="text-5xl font-black tracking-tighter uppercase">Security &amp; Compliance</h1>
          <p className="text-lg font-bold text-muted-foreground uppercase tracking-tight leading-relaxed">
            AegisSage was architected from day one as a HIPAA-compliant healthcare software platform.
            Every layer of our stack — from database encryption to API authentication — is designed
            to protect Medicare beneficiary data with enterprise-grade rigor.
          </p>
        </div>

        {/* Certification strip */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "HIPAA Compliant", sub: "PHI under BAA" },
            { label: "AES-256 Encrypted", sub: "At rest + in transit" },
            { label: "BAA Available", sub: "Upon request" },
          ].map(({ label, sub }) => (
            <div key={label} className="p-4 rounded-2xl bg-slate-900 text-center space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-white">{label}</p>
              <p className="text-[9px] font-medium text-slate-500 uppercase tracking-widest">{sub}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          {PILLARS.map((p, i) => (
            <section key={i} className={`p-6 rounded-3xl border ${p.border} ${p.bg} space-y-3`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white border border-current/10 flex items-center justify-center shrink-0 shadow-sm">
                  <p.icon className={`w-4 h-4 ${p.color}`} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-black uppercase tracking-tight">{p.title}</h2>
                  <Badge className="font-black uppercase text-[8px] tracking-widest bg-white/60 text-slate-600 border border-slate-200 px-2">{p.badge}</Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground font-medium leading-relaxed pl-12">{p.content}</p>
            </section>
          ))}
        </div>

        {/* BAA CTA */}
        <div className="p-8 rounded-3xl bg-slate-900 text-white space-y-4">
          <div className="flex items-center gap-3">
            <FileCheck className="w-6 h-6 text-primary shrink-0" />
            <p className="text-lg font-black uppercase tracking-tight">Request a BAA</p>
          </div>
          <p className="text-sm text-white/60 font-medium leading-relaxed">
            Business Associate Agreements are available upon request for all Agency Plan customers
            and any broker who requires formal HIPAA documentation. BAA execution typically takes
            3 business days and requires a signed countersignature from your designated HIPAA
            Compliance Officer or equivalent.
          </p>
          <div className="flex flex-col gap-1">
            <a href="mailto:compliance@aegissage.com" className="font-black text-primary hover:text-primary/80 transition-colors">compliance@aegissage.com</a>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Response within 3 business days</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-4">
          <Link href="/privacy-policy" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">Privacy Policy →</Link>
          <Link href="/terms-of-service" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">Terms of Service →</Link>
          <Link href="/baa" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors">BAA Agreement →</Link>
        </div>
      </main>
    </div>
  )
}
