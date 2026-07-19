import type { Metadata } from 'next';
import { NavSidebar } from '@/components/dashboard/nav-sidebar';
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar';
import { GlobalControls } from '@/components/dashboard/global-controls';

export const metadata: Metadata = {
  title: 'Control Room',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Single static grain layer over the whole shell (HANDOFF_SPEC §5). */}
      <div aria-hidden className="grain-overlay" />
      <NavSidebar />
      {/* `relative` so E-STOP stays anchored over every room. */}
      <main className="relative flex flex-1 flex-col overflow-hidden pb-16 md:pb-0">
        {children}
        <GlobalControls />
      </main>
      <MobileTabBar />
    </div>
  );
}
