"use client"

import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  iconOnly?: boolean
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="staffGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#CBD5E1" />
              <stop offset="100%" stopColor="#94A3B8" />
            </linearGradient>
            <linearGradient id="serpentGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2DD4BF" />
              <stop offset="50%" stopColor="#0D9488" />
              <stop offset="100%" stopColor="#115E59" />
            </linearGradient>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
              <feOffset dx="1" dy="1" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.2" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          
          {/* Medical Cross Background */}
          <path
            d="M40 15h20v25h25v20H60v25H40V60H15V40h25V15z"
            fill="#E2E8F0"
            className="opacity-80"
          />
          
          {/* Outer Circle Ring */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#99F6E4"
            strokeWidth="2.5"
            strokeDasharray="240 20"
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />

          {/* Central Staff */}
          <rect
            x="46"
            y="18"
            width="8"
            height="64"
            rx="4"
            fill="url(#staffGradient)"
          />
          
          {/* Serpent (Rod of Asclepius style) */}
          <path
            d="M38 72 
               C 38 72, 62 68, 62 55
               C 62 42, 38 45, 38 32
               C 38 19, 58 18, 58 18"
            stroke="url(#serpentGradient)"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
            filter="url(#shadow)"
          />
          
          {/* Serpent Head Detail */}
          <circle cx="58" cy="18" r="4" fill="#115E59" />
          <circle cx="60" cy="17" r="1" fill="white" className="opacity-80" />
        </svg>
      </div>
      {!iconOnly && (
        <span className="text-xl font-black tracking-tighter uppercase text-foreground">
          AegisSage
        </span>
      )}
    </div>
  )
}
