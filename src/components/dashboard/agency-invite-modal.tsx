"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { UserPlus, Loader2, CheckCircle2, AlertCircle } from "lucide-react"

// role values accepted by agency_invites table constraint
const INVITE_ROLES = [
  { value: "agency_admin",     label: "Manager" },
  { value: "customer_service", label: "Customer Service" },
  { value: "broker",           label: "Broker" },
] as const

type InviteRole = (typeof INVITE_ROLES)[number]["value"]

interface Props {
  agencyId: string
}

export function AgencyInviteModal({ agencyId }: Props) {
  const [open,    setOpen]    = useState(false)
  const [email,   setEmail]   = useState("")
  const [role,    setRole]    = useState<InviteRole>("broker")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const reset = () => {
    setEmail("")
    setRole("broker")
    setSuccess(false)
    setError(null)
    setLoading(false)
  }

  const handleOpen = (v: boolean) => {
    setOpen(v)
    if (!v) reset()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/team/invite", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, role, agency_id: agencyId }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`)
      } else {
        setSuccess(true)
      }
    } catch (err: any) {
      setError(err?.message ?? "Could not send invite. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9 gap-2"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Add Team Member
      </Button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="border-white/10 bg-[#0a0a0f] text-white sm:rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight">
              Add Team Member
            </DialogTitle>
          </DialogHeader>

          {success ? (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-sm font-bold text-white">
                Invite sent to <span className="text-primary">{email}</span>
              </p>
              <p className="text-xs text-white/40">
                They will receive an email with instructions to join your agency.
              </p>
              <Button
                variant="outline"
                className="border-white/20 text-white font-black uppercase text-[10px] tracking-widest"
                onClick={reset}
              >
                Send Another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 pt-2">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-white/70">
                  Email Address
                </Label>
                <Input
                  required
                  type="email"
                  placeholder="name@agency.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null) }}
                  className="h-12 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-white/70">
                  Role
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {INVITE_ROLES.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`h-10 rounded-xl border font-black text-[10px] uppercase tracking-widest transition-all ${
                        role === r.value
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-white/10 bg-white/5 text-white/50 hover:border-white/20"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-red-300">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase text-[10px] tracking-widest"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Invite"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
