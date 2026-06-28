'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { User, RefreshCw, CheckCircle2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface ProfileForm {
  first_name: string
  last_name: string
  npn: string
  phone: string
}

export default function ProfilePage() {
  const [form, setForm] = useState<ProfileForm>({ first_name: '', last_name: '', npn: '', phone: '' })
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, first_name, last_name, npn, phone')
        .eq('user_id', user.id)
        .maybeSingle()
      if (broker) {
        setBrokerId(broker.id)
        setForm({
          first_name: broker.first_name ?? '',
          last_name:  broker.last_name  ?? '',
          npn:        broker.npn        ?? '',
          phone:      broker.phone      ?? '',
        })
      }
      setLoading(false)
    })
  }, [])

  const handleSave = () => {
    if (!brokerId) return
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('brokers')
        .update({
          first_name: form.first_name.trim(),
          last_name:  form.last_name.trim(),
          npn:        form.npn.trim() || null,
          phone:      form.phone.trim() || null,
        })
        .eq('id', brokerId)
      if (error) {
        toast({ variant: 'destructive', title: 'Save failed', description: error.message })
      } else {
        setSaved(true)
        toast({ title: 'Profile saved' })
        setTimeout(() => setSaved(false), 2500)
      }
    })
  }

  const field = (id: keyof ProfileForm) => ({
    value: form[id],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [id]: e.target.value })),
  })

  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 border-b border-border px-8 flex items-center gap-3 bg-background sticky top-0 z-10">
        <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight">My Profile</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Name, NPN &amp; contact info</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-xl mx-auto w-full space-y-6 pb-32">
        {/* Context banner — explains how profile data is used in the platform */}
        <div className="rounded-2xl border border-border bg-muted/20 px-5 py-4 space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">How your profile is used</p>
          <p className="text-xs font-medium text-foreground/80 leading-relaxed">
            Your information here is scoped exclusively to your isolated broker account.
            It is not shared with or visible to any other account on the platform.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="rounded-3xl border border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-black uppercase tracking-tight">Broker Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest">First Name</Label>
                  <Input className="h-11 rounded-2xl" placeholder="Jane" {...field('first_name')} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest">Last Name</Label>
                  <Input className="h-11 rounded-2xl" placeholder="Smith" {...field('last_name')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">NPN (National Producer Number)</Label>
                <Input className="h-11 rounded-2xl font-mono" placeholder="12345678" {...field('npn')} />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  Your CMS-issued NPN is strictly utilized to sign compliance log verifications
                  and process automation workflows on behalf of your book. It is printed on AOR
                  forms and used only within your isolated broker context.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Phone</Label>
                <Input className="h-11 rounded-2xl" placeholder="(800) 555-0100" {...field('phone')} />
              </div>
              <Button
                onClick={handleSave}
                disabled={isPending}
                className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest gap-2"
              >
                {isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : saved
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : null}
                {isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
