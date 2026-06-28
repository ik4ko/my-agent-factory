import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MessageCircle, Shield, CreditCard, Clock } from 'lucide-react'

const CONTACTS = [
  {
    icon: MessageCircle,
    title: 'General Support',
    desc: 'For platform questions and technical issues',
    email: 'support@aegissage.com',
    response: 'Within 24 hours',
    btnLabel: 'Email Support',
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: Shield,
    title: 'Compliance & BAA',
    desc: 'For HIPAA, BAA, and compliance questions',
    email: 'compliance@aegissage.com',
    response: 'Within 2 business days',
    btnLabel: 'Email Compliance',
    color: 'bg-emerald-500/10 text-emerald-600',
  },
  {
    icon: CreditCard,
    title: 'Billing',
    desc: 'For subscription and billing questions',
    email: 'billing@aegissage.com',
    response: 'Within 24 hours',
    btnLabel: 'Email Billing',
    color: 'bg-amber-500/10 text-amber-600',
  },
]

export default async function SupportPage() {
  return (
    <div className="flex-1 p-4 md:p-8 space-y-8 pb-24">
      <div className="text-center space-y-3">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">
          AegisSage <span className="text-primary">Support</span>
        </h1>
        <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs max-w-xl mx-auto">
          Our team is here to help. Choose the right contact for your question.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {CONTACTS.map(({ icon: Icon, title, desc, email, response, btnLabel, color }) => (
          <Card key={title} className="rounded-3xl border border-border p-8 flex flex-col gap-6 hover:border-primary/30 transition-all shadow-sm">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${color}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-2">
              <h2 className="text-lg font-black uppercase tracking-tight">{title}</h2>
              <p className="text-sm font-bold text-muted-foreground">{desc}</p>
              <p className="font-mono text-[10px] text-muted-foreground/70 font-bold">{email}</p>
              <div className="flex items-center gap-1.5 pt-1">
                <Clock className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{response}</span>
              </div>
            </div>
            <Button asChild variant="outline"
              className="w-full rounded-2xl font-black uppercase text-[10px] tracking-widest h-11">
              <a href={`mailto:${email}`}>{btnLabel}</a>
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}
