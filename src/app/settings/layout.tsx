
"use client"

import { useAppStore, initializeStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  CreditCard,
  PanelLeftClose, PanelLeft,
  User, Bell,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

// GHL CRM connection moved to the unified import page: /dashboard/churn/upload
// Settings only exposes account-level controls — data sources live in the app.
const SETTINGS_ITEMS = [
  { id: "profile",       label: "My Profile",    icon: User,       href: "/settings/profile" },
  { id: "notifications", label: "Notifications", icon: Bell,       href: "/settings/notifications" },
  { id: "billing",       label: "Plan & Billing", icon: CreditCard, href: "/settings/billing" },
]

function SettingsSidebar() {
  const pathname = usePathname()
  const { isSidebarOpen, toggleSidebar } = useAppStore()

  const menuItems = SETTINGS_ITEMS

  return (
    <aside className={cn(
      "flex flex-col h-full bg-background border-r border-border shrink-0 z-40 overflow-hidden transition-all duration-300 ease-in-out",
      isSidebarOpen ? "w-64 opacity-100" : "w-0 opacity-0 border-none pointer-events-none"
    )}>
      <div className="h-16 flex items-center justify-between px-4 border-b border-border shrink-0">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap px-2">
          Agency Settings
        </h2>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleSidebar} 
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {menuItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left group relative cursor-pointer",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 font-black" 
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-white" : "text-muted-foreground/60 group-hover:text-primary")} />
                <span className="text-[10px] font-black uppercase tracking-widest truncate">{item.label}</span>
                {isActive && (
                  <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                )}
              </Link>
            )
          })}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-muted/5 shrink-0">
        <div className="p-2.5 rounded-xl border border-border bg-card/50 text-center">
          <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest opacity-50">
            AegisSage Workspace v4.2
          </p>
        </div>
      </div>
    </aside>
  )
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, toggleSidebar } = useAppStore()

  useEffect(() => {
    initializeStore()
  }, [])

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {!isSidebarOpen && (
        <div className="absolute left-4 top-4 z-50">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="rounded-xl hover:bg-muted">
            <PanelLeft className="w-5 h-5 text-primary" />
          </Button>
        </div>
      )}
      <SettingsSidebar />
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
        {children}
      </div>
    </div>
  )
}
