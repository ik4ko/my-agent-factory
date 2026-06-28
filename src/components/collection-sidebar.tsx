"use client"

import { Input } from "@/components/ui/input"
import { Search, UserPlus, Filter, AlertCircle, PanelLeftClose } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useState, useMemo } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"

export function CollectionSidebar({ forceMobile = false }: { forceMobile?: boolean }) {
  const { members, isSidebarOpen, toggleSidebar, toggleRoster } = useAppStore()
  const [search, setSearch] = useState("")
  const pathname = usePathname()
  const isMobile = useIsMobile()

  const filteredMembers = useMemo(() => {
    return members.filter(m => 
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      m.medicareId.toLowerCase().includes(search.toLowerCase())
    )
  }, [members, search])

  const handleClose = () => {
    if (isMobile) toggleRoster()
    else toggleSidebar()
  }

  return (
    <aside className={cn(
      "flex flex-col h-full bg-background border-r border-border shrink-0 z-40 overflow-hidden transition-all duration-300 ease-in-out",
      forceMobile ? "w-full" : (isMobile ? "hidden" : (isSidebarOpen ? "w-64 opacity-100" : "w-0 opacity-0 border-none pointer-events-none"))
    )}>
      {/* Header Area */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border shrink-0">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap px-2">
          Book of Business
        </h2>

        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-primary/5 hover:text-primary">
                  <Link href="/members/new" onClick={() => isMobile && toggleRoster()}>
                    <UserPlus className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Connect GHL</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleClose} 
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search Area */}
      <div className="p-4 pb-2 shrink-0">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input 
            placeholder="Search clients..." 
            className="pl-9 h-9 bg-muted/50 border-none rounded-xl text-[11px] focus-visible:ring-primary shadow-inner text-foreground font-bold uppercase tracking-tight"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        <div className="space-y-0.5">
          {filteredMembers.map((member) => (
            <Link 
              key={member.id}
              href={`/members/${member.id}`}
              onClick={() => isMobile && toggleRoster()}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 group",
                pathname === `/members/${member.id}` 
                  ? "bg-primary/5 text-primary font-bold" 
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0 transition-all",
                member.status === 'churn-risk' ? "bg-destructive animate-pulse" : 
                pathname === `/members/${member.id}` ? "bg-primary" : "bg-muted-foreground/30 group-hover:bg-muted-foreground/60"
              )} />
              
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold truncate leading-tight uppercase tracking-tight">
                  {member.fullName}
                </p>
                <p className="text-[9px] opacity-60 font-mono truncate leading-tight mt-0.5 uppercase">
                  {member.medicareId}
                </p>
              </div>

              {member.retentionScore < 50 && (
                <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
              )}
            </Link>
          ))}
          {filteredMembers.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-30">No members found.</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer Area */}
      <div className="p-4 border-t border-border bg-muted/5 shrink-0">
        <Button variant="outline" className="w-full justify-center gap-2 h-10 rounded-xl border-border bg-background text-foreground hover:bg-muted font-bold text-[9px] uppercase tracking-widest">
          <Filter className="w-3.5 h-3.5 text-primary" />
          Filter Carrier
        </Button>
      </div>
    </aside>
  )
}
