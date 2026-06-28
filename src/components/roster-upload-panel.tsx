interface CarrierStatus {
  carrier: string
  lastCheckedAt: string | null
  status: string | null
}

interface Props {
  carriers: CarrierStatus[]
  activeCarriers: string[]
}

export function RosterUploadPanel(_props: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      <a
        href="/dashboard/churn/upload"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        Upload Member List
      </a>
      <a
        href="/extension/connect"
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm font-medium transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2Z" /><path d="M11 8h6" /><path d="M11 12h6" /><path d="M11 16h6" /><path d="M7 8v.01" /><path d="M7 12v.01" /><path d="M7 16v.01" />
        </svg>
        Add Chrome Extension
      </a>
    </div>
  )
}
