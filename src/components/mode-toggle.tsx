
"use client"

import * as React from "react"
import { Moon, Sun, Check, Palette } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const colors = [
  { name: "Trust Blue", value: "blue", class: "bg-blue-600" },
  { name: "Clinical Cyan", value: "cyan", class: "bg-cyan-500" },
  { name: "Secure Green", value: "green", class: "bg-emerald-600" },
  { name: "Enterprise Purple", value: "purple", class: "bg-purple-600" },
  { name: "Alert Red", value: "red", class: "bg-red-600" },
  { name: "Warning Orange", value: "orange", class: "bg-orange-600" },
]

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [accentColor, setAccentColor] = React.useState<string>("blue")
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    const savedColor = localStorage.getItem("AegisSage-accent-color") || "blue"
    setAccentColor(savedColor)
    document.documentElement.setAttribute("data-theme", savedColor)
  }, [])

  const handleColorChange = (color: string) => {
    setAccentColor(color)
    localStorage.setItem("AegisSage-accent-color", color)
    document.documentElement.setAttribute("data-theme", color)
  }

  if (!mounted) return (
    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full border-border/50 bg-background/50">
      <Sun className="h-[1.2rem] w-[1.2rem]" />
    </Button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-10 w-10 rounded-full border-border/50 bg-background/50 backdrop-blur-sm shadow-sm hover:border-primary/50 transition-all group">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-foreground" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-foreground" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-2xl p-3 shadow-2xl border-border/50 bg-popover/95 backdrop-blur-xl">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2 py-2">
          Platform Appearance
        </DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-2 p-1">
          <Button 
            variant={resolvedTheme === 'light' ? 'secondary' : 'ghost'} 
            size="sm" 
            onClick={() => setTheme("light")}
            className="rounded-xl flex items-center justify-start gap-2 h-9 font-bold"
          >
            <Sun className="w-4 h-4" />
            <span>Light</span>
          </Button>
          <Button 
            variant={resolvedTheme === 'dark' ? 'secondary' : 'ghost'} 
            size="sm" 
            onClick={() => setTheme("dark")}
            className="rounded-xl flex items-center justify-start gap-2 h-9 font-bold"
          >
            <Moon className="w-4 h-4" />
            <span>Dark</span>
          </Button>
        </div>
        
        <DropdownMenuSeparator className="my-3 opacity-50" />
        
        <div className="flex items-center justify-between px-2 mb-2">
          <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground p-0">
            Agency Accent
          </DropdownMenuLabel>
          <Palette className="w-3 h-3 text-muted-foreground opacity-50" />
        </div>
        
        <div className="grid grid-cols-3 gap-2 p-1">
          {colors.map((color) => (
            <button
              key={color.value}
              onClick={() => handleColorChange(color.value)}
              className={`group relative h-12 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${color.class} shadow-inner`}
              title={color.name}
            >
              {accentColor === color.value ? (
                <div className="bg-white/20 backdrop-blur-sm rounded-full p-1 border border-white/30 shadow-sm animate-in zoom-in-50 duration-200">
                  <Check className="w-4 h-4 text-white" />
                </div>
              ) : (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/10 rounded-full p-1">
                  <div className="w-4 h-4 rounded-full border border-white/20" />
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 px-2 py-1.5 rounded-xl bg-muted/50 text-[9px] font-bold text-muted-foreground text-center uppercase tracking-widest">
          Clinical Grade Palettes
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
