import type { Metadata } from 'next';
import { NavSidebar } from '@/components/dashboard/nav-sidebar';
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar';

export const metadata: Metadata = {
  title: 'Control Room',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <NavSidebar />
      <main className="flex flex-1 flex-col overflow-hidden pb-16 md:pb-0">{children}</main>
      <MobileTabBar />
    </div>
  );
}
