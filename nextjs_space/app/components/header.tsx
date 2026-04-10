'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { Rocket, LogOut, LayoutDashboard, LogIn, Search, Newspaper, Rss } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const { data: session, status } = useSession() || {};
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-700 transition-colors">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">Ad <span className="text-blue-600">Launch</span></span>
        </Link>

        <nav className="hidden md:flex items-center gap-2">
          <Link href="/search" className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors text-sm font-medium">
            <Search className="w-4 h-4" /> Find Businesses
          </Link>
          {status === 'authenticated' ? (
            <>
              <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors text-sm font-medium">
                <LayoutDashboard className="w-4 h-4" /> Dashboard
              </Link>
              <Link href="/dashboard/social" className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors text-sm font-medium">
                <Newspaper className="w-4 h-4" /> Social Posts
              </Link>
              <Link href="/dashboard/feeds" className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors text-sm font-medium">
                <Rss className="w-4 h-4" /> Content Feeds
              </Link>
              <button onClick={() => signOut({ callbackUrl: '/' })} className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors text-sm font-medium">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </>
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
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-3 space-y-2">
          <Link href="/search" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 text-sm" onClick={() => setMenuOpen(false)}>
            <Search className="w-4 h-4" /> Find Businesses
          </Link>
          {status === 'authenticated' ? (
            <>
              <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 text-sm" onClick={() => setMenuOpen(false)}>
                <LayoutDashboard className="w-4 h-4" /> Dashboard
              </Link>
              <Link href="/dashboard/social" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 text-sm" onClick={() => setMenuOpen(false)}>
                <Newspaper className="w-4 h-4" /> Social Posts
              </Link>
              <Link href="/dashboard/feeds" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 text-sm" onClick={() => setMenuOpen(false)}>
                <Rss className="w-4 h-4" /> Content Feeds
              </Link>
              <button onClick={() => { signOut({ callbackUrl: '/' }); setMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 text-sm w-full">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </>
          ) : (
            <Link href="/login" className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm" onClick={() => setMenuOpen(false)}>
              <LogIn className="w-4 h-4" /> Sign In
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
