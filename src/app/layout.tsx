
import type { Metadata } from 'next';
import './globals.css';
import { CommandBar } from '@/components/command-bar';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';
import { AppShell } from '@/components/app-layout-shell';
import { AppSidebar } from '@/components/app-sidebar';

export const metadata: Metadata = {
  title: 'AegisSage | Medicare Retention SaaS',
  description: 'Enterprise-grade Medicare member retention platform for agencies',
  icons: {
    icon: [
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
      </head>
      <body className="font-body antialiased bg-background text-foreground selection:bg-primary/10" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <AppShell sidebar={<AppSidebar />}>
            {children}
          </AppShell>
          <CommandBar />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
