"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"

import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"

const marketingLinks = [
  { href: "#how-it-works", label: "How It Works" },
  { href: "#what-we-do",   label: "What We Do" },
]

function NavLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-2 text-xs font-black uppercase tracking-widest transition-all ${
        active ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      {label}
    </Link>
  )
}

export function SiteNavbar() {
  const pathname = usePathname() ?? "/"
  const [activeSection, setActiveSection] = useState("")
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (pathname !== "/") {
      setActiveSection("")
      return
    }

    const ids = marketingLinks.map((link) => link.href.slice(1))
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (!nodes.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) setActiveSection(`#${visible.target.id}`)
      },
      { rootMargin: "-18% 0px -58% 0px", threshold: [0.2, 0.45, 0.7] }
    )

    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [pathname])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0f]/85 px-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4">
        <Link href="/" aria-label="AegisSage home" className="interactive-item rounded-lg">
          <Logo className="[&_span]:text-white" />
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          {marketingLinks.map((link) => (
            <NavLink
              key={link.href}
              href={pathname === "/" ? link.href : `/${link.href}`}
              label={link.label}
              active={pathname === "/" && activeSection === link.href}
            />
          ))}
          <NavLink
            href={pathname === "/" ? "#pricing" : "/#pricing"}
            label="Pricing"
            active={pathname === "/pricing"}
          />
        </nav>

        {/* Desktop right actions */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-white/[0.04] hover:text-white"
          >
            Sign In
          </Link>
          <Button asChild className="bg-primary font-black text-black hover:bg-primary/90">
            <Link href="/signup">Sign Up</Link>
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
          className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white transition-all hover:border-primary/40 md:hidden"
        >
          <Menu className={`absolute h-5 w-5 transition-all ${mobileOpen ? "rotate-90 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100"}`} />
          <X className={`absolute h-5 w-5 transition-all ${mobileOpen ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-75 opacity-0"}`} />
        </button>
      </div>

      {/* Mobile slide drawer */}
      <div
        className={`fixed inset-x-3 top-20 z-50 rounded-2xl border border-white/10 bg-[#0f1117]/98 p-4 backdrop-blur-xl transition-all duration-300 md:hidden ${
          mobileOpen ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"
        }`}
      >
        <div className="grid gap-2">
          {marketingLinks.map((link) => (
            <Link
              key={link.href}
              href={pathname === "/" ? link.href : `/${link.href}`}
              onClick={() => setMobileOpen(false)}
              className="rounded-xl border border-transparent px-4 py-3 text-sm font-bold text-slate-300 transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            >
              {link.label}
            </Link>
          ))}

          <Link
            href={pathname === "/" ? "#pricing" : "/#pricing"}
            onClick={() => setMobileOpen(false)}
            className={`rounded-xl border px-4 py-3 text-sm font-bold transition-all ${
              pathname === "/pricing"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-transparent text-slate-300 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            }`}
          >
            Pricing
          </Link>

          <Link
            href="/login"
            onClick={() => setMobileOpen(false)}
            className="rounded-xl border border-transparent px-4 py-3 text-sm font-bold text-slate-500 transition-all hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
          >
            Sign In
          </Link>

          <Button asChild className="w-full bg-primary font-black text-black hover:bg-primary/90">
            <Link href="/signup" onClick={() => setMobileOpen(false)}>Sign Up</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
