
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function SettingsPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/settings/profile")
  }, [router])

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Loading Agency Workspace...</p>
      </div>
    </div>
  )
}
