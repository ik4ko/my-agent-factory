"use client"

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

interface MarxStatusBarProps {
  verifiedCount: number
  totalMembers: number
  memberIds: string[]
}

export function MarxStatusBar({ verifiedCount, totalMembers, memberIds }: MarxStatusBarProps) {
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function handleBulkMarxCheck() {
    if (memberIds.length === 0 || loading) return
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/marx/bulk-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: memberIds }),
      })
      const data = await res.json()
      if (res.ok) {
        setFeedback(`${data.verified ?? 0} verified · refresh to update counts`)
      } else {
        setFeedback(data.error ?? 'Check failed')
      }
    } catch {
      setFeedback('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-2xl bg-slate-900/40 border border-slate-800">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="w-4 h-4 text-slate-500 shrink-0" />
        <p className="text-sm text-slate-400">
          <span className="text-white font-semibold">{verifiedCount}</span>
          {' '}of{' '}
          <span className="text-white font-semibold">{totalMembers}</span>
          {' '}members MARx verified
        </p>
        {feedback && (
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 ml-1">
            · {feedback}
          </span>
        )}
      </div>
      {memberIds.length > 0 && (
        <button
          onClick={handleBulkMarxCheck}
          disabled={loading}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Running…' : 'Run MARx Check on all →'}
        </button>
      )}
    </div>
  )
}
