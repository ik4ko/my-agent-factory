import { Mail, Clock, Shield } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export const metadata = {
  title: "Support | AegisSage",
  description: "Get help with AegisSage — contact support or browse common questions.",
}

const FAQS = [
  {
    question: "How do I add clients to my book of business?",
    answer:
      "After signing in, navigate to your Book of Business and use the Upload Roster option. You will need each client's full name, Medicare Beneficiary Identifier (MBI), and their current plan name. Supported formats are CSV and Excel.",
  },
  {
    question: "What triggers a plan switch alert?",
    answer:
      "AegisSage monitors CMS enrollment data for your clients. An alert is triggered when we detect that a client's plan status has changed or a future plan change is pending for the upcoming enrollment period. You will be notified by email as soon as a change is detected.",
  },
  {
    question: "Is my client data secure?",
    answer:
      "Yes. All data is encrypted at rest and in transit. Access is restricted so brokers can only view their own clients. AegisSage maintains HIPAA-compliant infrastructure and immutable audit logs for all PHI access events.",
  },
  {
    question: "What is the difference between the Broker and Agency plans?",
    answer:
      "The Broker plan is for individual producers managing their own book of business at $149/mo. The Agency plan supports teams of up to 5 seats with an agency-wide dashboard, role-based access for owners, managers, and customer service staff, and mass campaign capabilities at $749/mo. Additional seats can be added at $50 per seat per month. Yearly billing is available at a 17% discount.",
  },
  {
    question: "How do I cancel my account?",
    answer:
      "Contact support@aegissage.com. Note that all sales are final and no refunds are issued per our Terms of Service.",
  },
]

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="max-w-2xl mx-auto py-20 px-8 space-y-14">

        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-4xl font-black uppercase tracking-tighter text-white">
            AegisSage <span className="text-primary">Support</span>
          </h1>
          <p className="text-sm font-medium text-white/50 leading-relaxed">
            We&apos;re here to help. Reach out directly or find answers to common questions below.
          </p>
        </div>

        {/* Contact card */}
        <div className="flex items-start gap-5 rounded-3xl border border-white/10 bg-white/[0.03] p-7">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-black uppercase tracking-tight text-white">General Support</h2>
            <a
              href="mailto:support@aegissage.com"
              className="block font-black text-primary hover:text-primary/80 transition-colors"
            >
              support@aegissage.com
            </a>
            <div className="flex items-center gap-1.5 pt-0.5">
              <Clock className="h-3.5 w-3.5 text-white/30" />
              <span className="text-xs font-black uppercase tracking-widest text-white/40">
                Response within 1 business day · Mon–Fri, 9am–6pm EST
              </span>
            </div>
          </div>
        </div>

        {/* FAQ accordion */}
        <div className="space-y-4">
          <h2 className="text-xl font-black uppercase tracking-tight text-white">Common Questions</h2>
          <Accordion type="single" collapsible className="w-full space-y-2">
            {FAQS.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 data-[state=open]:border-primary/30 data-[state=open]:bg-primary/[0.04] transition-colors"
              >
                <AccordionTrigger className="text-sm font-black uppercase tracking-tight text-white hover:text-primary hover:no-underline transition-colors py-5">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm font-medium leading-relaxed text-white/50 pb-5">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* HIPAA footer note */}
        <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
          <Shield className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />
          <p className="text-xs font-medium text-white/40 leading-relaxed">
            For HIPAA compliance questions or breach reports, contact{" "}
            <a href="mailto:privacy@aegissage.com" className="text-primary hover:text-primary/80 transition-colors font-bold">
              privacy@aegissage.com
            </a>
          </p>
        </div>

      </main>
    </div>
  )
}
