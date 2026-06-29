import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { QueryProvider } from '@/components/providers/query-provider';
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${mono.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
