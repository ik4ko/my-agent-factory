
"use client"

import * as React from "react"
import { Globe, Check } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { languages } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface LanguageSelectorProps {
  className?: string
  align?: "start" | "center" | "end"
  variant?: "ghost" | "outline" | "default"
}

export function LanguageSelector({ className, align = "end", variant = "outline" }: LanguageSelectorProps) {
  const { language, setLanguage } = useAppStore()
  const currentLang = languages.find(l => l.code === language) || languages[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant={variant} 
          size="sm" 
          className={cn("rounded-xl h-9 gap-2 px-3 font-black uppercase text-[10px] tracking-widest", className)}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{currentLang.code.toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56 rounded-2xl p-2 shadow-2xl border-border/50 bg-popover/95 backdrop-blur-xl">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-3 py-2">
          Select Language
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="opacity-50" />
        <div className="grid grid-cols-1 gap-1">
          {languages.map((lang) => (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => setLanguage(lang.code as any)}
              className={cn(
                "rounded-xl flex items-center justify-between h-10 px-3 transition-all cursor-pointer",
                language === lang.code ? "bg-primary/10 text-primary font-black" : "font-bold text-muted-foreground hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{lang.flag}</span>
                <span className="text-xs uppercase tracking-tight">{lang.name}</span>
              </div>
              {language === lang.code && <Check className="w-3.5 h-3.5" />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
