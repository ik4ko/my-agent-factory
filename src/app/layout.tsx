import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { QueryProvider } from '@/components/providers/query-provider';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { TitleBar } from '@/components/desktop/TitleBar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'My Agent Factory',
    template: '%s — My Agent Factory',
  },
  description: 'Cyberpunk AI agent orchestration dashboard. Dispatch Codex, Scout, Phantom, and Architect via natural language commands.',
  keywords: ['AI agents', 'orchestration', 'Claude', 'automation', 'dashboard'],
  authors: [{ name: 'My Agent Factory' }],
  openGraph: {
    type: 'website',
    title: 'My Agent Factory',
    description: 'Cyberpunk AI agent orchestration dashboard powered by Hermes + Claude.',
    siteName: 'My Agent Factory',
  },
  twitter: {
    card: 'summary',
    title: 'My Agent Factory',
    description: 'Cyberpunk AI agent orchestration dashboard powered by Hermes + Claude.',
  },
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Agent Factory',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark h-full ${inter.variable} ${mono.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="h-full antialiased">
        <QueryProvider>
          {/* Desktop-shell flex column: TitleBar (h-8, Tauri-only — renders
              null in browsers) pinned to the viewport ceiling, everything
              else in a min-h-0 flex-1 well. Pages size with h-full/min-h-full
              (never h-dvh/100vh) so content can't bleed under the native
              drag region in the frameless shell. */}
          <div className="flex h-dvh flex-col overflow-hidden bg-background">
            <TitleBar />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </QueryProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
