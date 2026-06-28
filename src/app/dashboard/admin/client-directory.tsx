"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search, AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react"
import Link from "next/link"

export interface DirectoryMember {
  id:                 string
  full_name:          string | null
  carrier:            string | null
  plan_name:          string | null
  enrollment_status:  string | null
  verification_status: string | null
  last_marx_check:    string | null
  is_chronic:         boolean | null
  broker_id:          string | null
  broker_name:        string | null  // pre-joined server-side
}

interface Props {
  members:       DirectoryMember[]
  brokerOptions: { id: string; name: string }[]  // for owner filter dropdown
  isOwner:       boolean
}

const STATUS_CLS: Record<string, string> = {
  active:     'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  switching:  'bg-amber-500/10 text-amber-600 border-amber-500/20',
  termed:     'bg-red-500/10 text-red-600 border-red-500/20',
  disenrolled:'bg-red-500/10 text-red-600 border-red-500/20',
  pending:    'bg-slate-500/10 text-slate-500 border-slate-500/20',
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function ClientDirectory({ members, brokerOptions, isOwner }: Props) {
  const [query,        setQuery]        = useState('')
  const [brokerFilter, setBrokerFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return members.filter(m => {
      if (brokerFilter !== 'all' && m.broker_id !== brokerFilter) return false
      if (statusFilter !== 'all' && m.enrollment_status !== statusFilter) return false
      if (!q) return true
      return (
        (m.full_name?.toLowerCase().includes(q)) ||
        (m.carrier?.toLowerCase().includes(q)) ||
        (m.plan_name?.toLowerCase().includes(q)) ||
        (m.broker_name?.toLowerCase().includes(q))
      )
    })
  }, [members, query, brokerFilter, statusFilter])

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, carrier, or plan..."
            className="pl-9 h-10 rounded-xl text-sm"
          />
        </div>
        {isOwner && brokerOptions.length > 1 && (
          <Select value={brokerFilter} onValueChange={setBrokerFilter}>
            <SelectTrigger className="h-10 w-44 rounded-xl text-sm">
              <SelectValue placeholder="All Brokers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brokers</SelectItem>
              {brokerOptions.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-40 rounded-xl text-sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="switching">Switching</SelectItem>
            <SelectItem value="termed">Termed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {filtered.length.toLocaleString()} of {members.length.toLocaleString()} members
        </p>
        {(query || brokerFilter !== 'all' || statusFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] font-black uppercase tracking-widest text-muted-foreground"
            onClick={() => { setQuery(''); setBrokerFilter('all'); setStatusFilter('all') }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3 text-center">
          <Search className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
            No clients match your search
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-transparent border-none">
                {['Client', 'Carrier', 'Plan', isOwner ? 'Broker' : null, 'Status', 'MARx Check', 'C-SNP'].filter(Boolean).map(h => (
                  <TableHead key={h!} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map(m => {
                const status  = m.enrollment_status ?? 'unknown'
                const statusCls = STATUS_CLS[status] ?? 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                const isVerified = !!m.last_marx_check
                return (
                  <TableRow key={m.id} className="border-border/50 hover:bg-muted/20">
                    <TableCell className="px-4 py-3 font-bold text-sm">
                      <Link
                        href={`/dashboard/book/${m.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {m.full_name ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 text-[10px] font-bold uppercase text-muted-foreground">
                      {m.carrier ?? '—'}
                    </TableCell>
                    <TableCell className="px-4 text-[10px] text-muted-foreground max-w-[160px] truncate">
                      {m.plan_name ?? '—'}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="px-4 text-[10px] text-muted-foreground">
                        {m.broker_name ?? '—'}
                      </TableCell>
                    )}
                    <TableCell className="px-4">
                      <Badge className={`text-[8px] font-black uppercase px-2 border ${statusCls}`}>
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <span className={`flex items-center gap-1 text-[10px] font-bold ${isVerified ? 'text-emerald-600' : 'text-muted-foreground/40'}`}>
                        {isVerified
                          ? <><CheckCircle2 className="w-3 h-3" />{fmt(m.last_marx_check)}</>
                          : <><Clock className="w-3 h-3" />Pending</>}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 text-center">
                      {m.is_chronic
                        ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mx-auto" />
                        : <XCircle className="w-3 h-3 text-muted-foreground/20 mx-auto" />}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {filtered.length > 200 && (
            <p className="text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground py-3 border-t border-border">
              Showing first 200 of {filtered.length} — refine your search to narrow results
            </p>
          )}
        </div>
      )}
    </div>
  )
}
