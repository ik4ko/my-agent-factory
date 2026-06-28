'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users, ShieldCheck, AlertTriangle, CheckCircle2,
  XCircle, KeyRound, ArrowUpRight,
} from 'lucide-react'
import { BookMemberTable, MemberRow } from './book-member-table'

type StatFilter = 'all' | 'verified' | 'switching' | 'termed' | 'unverified' | 'no_mbi'

const TERMED_STATUSES = ['termed', 'disenrolled', 'left', 'deceased', 'recoverable', 'termed_no_partb']

export function BookDashboard({ members }: { members: MemberRow[] }) {
  const [activeFilter, setActiveFilter] = useState<StatFilter>('all')

  const totalMembers    = members.length
  const verifiedCount   = members.filter(m => m.enrollment_status === 'active' && m.last_marx_check).length
  const switchingCount  = members.filter(m => m.enrollment_status === 'switching').length
  const termedCount     = members.filter(m => TERMED_STATUSES.includes(m.enrollment_status ?? '') || TERMED_STATUSES.includes(m.status ?? '')).length
  const unverifiedCount = members.filter(m => !m.has_mbi || !m.last_marx_check).length
  const noMbiCount      = members.filter(m => !m.mbi).length

  const filterMembers = (f: StatFilter): MemberRow[] => {
    switch (f) {
      case 'verified':   return members.filter(m => m.enrollment_status === 'active' && m.last_marx_check)
      case 'switching':  return members.filter(m => m.enrollment_status === 'switching')
      case 'termed':     return members.filter(m => TERMED_STATUSES.includes(m.enrollment_status ?? '') || TERMED_STATUSES.includes(m.status ?? ''))
      case 'unverified': return members.filter(m => !m.has_mbi || !m.last_marx_check)
      case 'no_mbi':     return members.filter(m => !m.mbi)
      default:           return members
    }
  }

  const filteredMembers = filterMembers(activeFilter)

  const cards: Array<{
    key: StatFilter
    label: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    cls: string
  }> = [
    { key: 'all',        label: 'Total',       value: totalMembers,    icon: Users,        cls: 'text-slate-400 bg-slate-800' },
    { key: 'verified',   label: '✓ Verified',  value: verifiedCount,   icon: CheckCircle2, cls: verifiedCount > 0 ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-400 bg-slate-800' },
    { key: 'switching',  label: '⚠ Switching', value: switchingCount,  icon: AlertTriangle, cls: switchingCount > 0 ? 'text-orange-400 bg-orange-500/10' : 'text-slate-400 bg-slate-800' },
    { key: 'termed',     label: '✗ Left',      value: termedCount,     icon: XCircle,      cls: termedCount > 0 ? 'text-red-500 bg-red-500/10' : 'text-slate-400 bg-slate-800' },
    { key: 'unverified', label: 'Unverified',  value: unverifiedCount, icon: ShieldCheck,  cls: 'text-slate-400 bg-slate-800' },
    { key: 'no_mbi',     label: 'No MBI',      value: noMbiCount,      icon: KeyRound,     cls: noMbiCount > 0 ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-800' },
  ]

  const handleCardClick = (key: StatFilter) => {
    setActiveFilter(prev => (prev === key ? 'all' : key))
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-slate-800 flex items-center justify-center">
          <Users className="w-8 h-8 text-slate-600" />
        </div>
        <div>
          <p className="text-lg font-black uppercase tracking-tight text-white">No Members Yet</p>
          <p className="text-sm text-slate-400 mt-1">
            Sync from a carrier portal with the extension, or upload a roster CSV.
          </p>
        </div>
        <Button asChild size="sm"
          className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 mt-2">
          <Link href="/dashboard/churn/upload">
            <ArrowUpRight className="w-3.5 h-3.5" /> Upload Roster
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map(({ key, label, value, icon: Icon, cls }) => (
          <Card
            key={key}
            onClick={() => handleCardClick(key)}
            className={`rounded-2xl border-slate-800 bg-slate-900/60 shadow-sm cursor-pointer select-none transition-all ${
              activeFilter === key
                ? 'ring-2 ring-teal-500 border-teal-500/50'
                : 'hover:border-slate-600'
            }`}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cls}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xl font-black text-white">{value}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredMembers.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm font-black uppercase tracking-tight text-slate-500">
            No members match this filter
          </p>
          <button
            onClick={() => setActiveFilter('all')}
            className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
          >
            Show All
          </button>
        </div>
      ) : (
        <BookMemberTable members={filteredMembers} />
      )}
    </>
  )
}
