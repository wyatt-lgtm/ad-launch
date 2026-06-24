'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Rocket, LogOut, LayoutDashboard, LogIn, Search, Newspaper, Rss, Send, Coins, Building2, FolderOpen, BarChart3, CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { useActiveBusiness } from '@/hooks/use-active-business';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Paths that count as "active" for this tab (startsWith match) */
  matchPaths?: string[];
}

export default function Header() {
  const { data: session, status } = useSession() || {};
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const bizCtx = useActiveBusiness();

  const publicNav: NavItem[] = [
    { href: '/search', label: 'Find Businesses', icon: Search, matchPaths: ['/search'] },
  ];

  const authNav: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, matchPaths: ['/dashboard'] },
    { href: '/dashboard/social', label: 'Social Posts', icon: Newspaper, matchPaths: ['/dashboard/social'] },
    { href: '/dashboard/social/publishing', label: 'Publish Queue', icon: Send, matchPaths: ['/dashboard/social/publishing'] },
    { href: '/dashboard/social/schedule', label: 'Schedule', icon: CalendarClock, matchPaths: ['/dashboard/social/schedule'] },
    { href: '/dashboard/feeds', label: 'Content Feeds', icon: Rss, matchPaths: ['/dashboard/feeds'] },
    { href: '/dashboard/marketing', label: 'Marketing', icon: BarChart3, matchPaths: ['/dashboard/marketing'] },
    { href: '/dashboard/credits', label: 'Credits', icon: Coins, matchPaths: ['/dashboard/credits'] },
    { href: '/dashboard/assets', label: 'Assets', icon: FolderOpen, matchPaths: ['/dashboard/assets'] },
  ];

  // Determine if a nav item is active. More specific paths checked first via sort.
  const isActive = (item: NavItem): boolean => {
    const paths = item.matchPaths ?? [item.href];
    // Exact match for /dashboard to avoid matching /dashboard/social etc.
    if (item.href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return paths.some(p => pathname?.startsWith(p));
  };

  // Need to resolve /dashboard/social vs /dashboard/social/publishing or /schedule
  // sub-routes are more specific, so check them first
  const getActiveClass = (item: NavItem): string => {
    // Special: for /dashboard/social, only match if NOT on sub-routes
    if (item.href === '/dashboard/social' && (pathname?.startsWith('/dashboard/social/publishing') || pathname?.startsWith('/dashboard/social/schedule'))) {
      return 'hover:bg-gray-100 text-gray-700';
    }
    if (isActive(item)) {
      return 'bg-blue-600 text-white shadow-sm';
    }
    return 'hover:bg-gray-100 text-gray-700';
  };

  const getMobileActiveClass = (item: NavItem): string => {
    if (item.href === '/dashboard/social' && (pathname?.startsWith('/dashboard/social/publishing') || pathname?.startsWith('/dashboard/social/schedule'))) {
      return 'hover:bg-gray-100 text-gray-700';
    }
    if (isActive(item)) {
      return 'bg-blue-600 text-white';
    }
    return 'hover:bg-gray-100 text-gray-700';
  };

  const allNav = status === 'authenticated' ? [...publicNav, ...authNav] : publicNav;

  return (
    <>
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-700 transition-colors">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">Launch <span className="text-blue-600">OS</span></span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {allNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${getActiveClass(item)}`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </Link>
            );
          })}
          {status === 'authenticated' ? (
            <button onClick={() => signOut({ callbackUrl: '/' })} className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors text-sm font-medium">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          ) : (
            <Link href="/login" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <LogIn className="w-4 h-4" /> Sign In
            </Link>
          )}
        </nav>

        <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-lg hover:bg-gray-100">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-3 space-y-1">
          {allNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${getMobileActiveClass(item)}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </Link>
            );
          })}
          {status === 'authenticated' ? (
            <button onClick={() => { signOut({ callbackUrl: '/' }); setMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 text-sm w-full">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          ) : (
            <Link href="/login" className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm" onClick={() => setMenuOpen(false)}>
              <LogIn className="w-4 h-4" /> Sign In
            </Link>
          )}
        </div>
      )}
    </header>

    {/* Global Business Context Banner — hidden on analysis/results pages which show their own context */}
    {status === 'authenticated' && pathname !== '/' && pathname !== '/login' && pathname !== '/register' && !pathname?.startsWith('/analyze/') && !pathname?.startsWith('/results/') && (
      <div className="bg-slate-50 border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex items-center gap-2 h-9 text-xs">
          <Building2 className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
          {bizCtx.activeBusiness ? (
            <>
              <span className="font-semibold text-slate-700">Current Business:</span>
              <span className="text-slate-900 font-medium">{bizCtx.activeBusiness.businessName || bizCtx.activeBusiness.businessDomain}</span>
              <span className="text-slate-400 hidden sm:inline">·</span>
              <span className="text-slate-500 hidden sm:inline">{bizCtx.activeBusiness.businessDomain}</span>
            </>
          ) : (
            <span className="text-amber-600 font-medium">No business selected — select one from the Dashboard</span>
          )}
        </div>
      </div>
    )}
    </>
  );
}
