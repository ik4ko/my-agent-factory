"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Settings,
  User,
  Zap,
  LayoutDashboard,
  Home
} from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

export function CommandBar() {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search members..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => { router.push('/dashboard'); setOpen(false); }}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Go to Command Center</span>
          </CommandItem>
          <CommandItem onSelect={() => { router.push('/'); setOpen(false); }}>
            <Home className="mr-2 h-4 w-4" />
            <span>Go to Landing Page</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { router.push('/members/new'); setOpen(false); }}>
            <Plus className="mr-2 h-4 w-4" />
            <span>Enroll New Member</span>
          </CommandItem>
          <CommandItem onSelect={() => { setOpen(false); }}>
            <Zap className="mr-2 h-4 w-4" />
            <span>Trigger AI Risk Report</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem onSelect={() => { router.push('/settings'); setOpen(false); }}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
            <CommandShortcut>CmdS</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
