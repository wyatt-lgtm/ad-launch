'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Rocket, LogOut, LogIn, Search, Newspaper, Building2, ChevronDown,
  Plus, Zap, Lightbulb, PenLine, Layers, Globe, FileText, Image as ImageIcon,
  Video, Mail, Upload, BarChart3, TrendingUp, Users, Target, LineChart,
  Settings, CreditCard, Bell, Shield, Link2, Compass, AlertTriangle,
  CheckCircle, Menu, X, Layout, Wrench, Eye, BookOpen, MapPin, Bug,
  ArrowUpRight, Megaphone, LayoutDashboard
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useActiveBusiness } from '@/hooks/use-active-business';

// ── Alert Badge Types ────────────────────────────────────────────────────────
type BadgeSeverity = 'none' | 'blue' | 'amber' | 'red';
interface NavAlerts {
  create: { count: number; severity: BadgeSeverity };
  social: { count: number; severity: BadgeSeverity };
  website: { count: number; severity: BadgeSeverity };
  seo: { count: number; severity: BadgeSeverity };
  insights: { count: number; severity: BadgeSeverity };
  account: { count: number; severity: BadgeSeverity };
}

const EMPTY_ALERTS: NavAlerts = {
  create: { count: 0, severity: 'none' },
  social: { count: 0, severity: 'none' },
  website: { count: 0, severity: 'none' },
  seo: { count: 0, severity: 'none' },
  insights: { count: 0, severity: 'none' },
  account: { count: 0, severity: 'none' },
};

function AlertBadge({ count, severity }: { count: number; severity: BadgeSeverity }) {
  if (count === 0 && severity === 'none') return null;
  const colorMap: Record<BadgeSeverity, string> = {
    none: '',
    blue: 'bg-blue-500 text-white',
    amber: 'bg-amber-500 text-white',
    red: 'bg-red-500 text-white',
  };
  const display = severity === 'red' && count === 0 ? '!' : count > 9 ? '9+' : String(count);
  return (
    <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1 ${colorMap[severity]} shadow-sm`}>
      {display}
    </span>
  );
}

// ── Dropdown Wrapper ─────────────────────────────────────────────────────────
function Dropdown({ trigger, children, align = 'left', width = 'w-64' }: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>
      {open && (
        <div
          className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-[60] max-h-[80vh] overflow-y-auto`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function DropdownItem({ href, icon: Icon, label, desc, onClick, disabled }: {
  href?: string;
  icon: React.ElementType;
  label: string;
  desc?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls = `flex items-start gap-3 px-3 py-2 rounded-lg text-sm transition-colors w-full text-left ${
    disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
  }`;
  const content = (
    <>
      <Icon className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-medium text-gray-800 text-sm">{label}</div>
        {desc && <div className="text-[11px] text-gray-400 leading-tight">{desc}</div>}
      </div>
    </>
  );
  if (href && !disabled) {
    return <Link href={href} className={cls}>{content}</Link>;
  }
  return <button className={cls} onClick={disabled ? undefined : onClick} disabled={disabled}>{content}</button>;
}

function DropdownDivider() {
  return <div className="border-t border-gray-100 my-1" />;
}

// ── Business Selector (inline header version) ────────────────────────────────
function BusinessSelector({ bizCtx }: { bizCtx: ReturnType<typeof useActiveBusiness> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeName = bizCtx.activeBusiness?.businessName || bizCtx.activeBusiness?.businessDomain || 'Select Business';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors max-w-[200px] border border-blue-200"
      >
        <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{activeName}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-[60] max-h-[60vh] overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Your Businesses</div>
          {bizCtx.businesses.map((biz) => {
            const isActive = biz.id === bizCtx.activeBusiness?.id;
            const displayName = biz.businessName || biz.businessDomain;
            return (
              <button
                key={biz.id}
                onClick={() => {
                  bizCtx.setActiveBusiness(biz);
                  setOpen(false);
                }}
                className={`flex items-center gap-3 w-full px-3 py-2.5 text-left text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{displayName}</div>
                  <div className="text-[11px] text-gray-400 truncate">{biz.businessDomain}</div>
                </div>
                {isActive && <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />}
              </button>
            );
          })}
          <DropdownDivider />
          <button
            onClick={() => { setOpen(false); router.push('/search'); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add New Business
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Header ──────────────────────────────────────────────────────────────
export default function Header() {
  const { data: session, status } = useSession() || {};
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const bizCtx = useActiveBusiness();
  const [alerts, setAlerts] = useState<NavAlerts>(EMPTY_ALERTS);
  const isAdmin = (session?.user as any)?.role === 'admin';

  // Fetch alert badges
  const fetchAlerts = useCallback(async () => {
    if (status !== 'authenticated') return;
    try {
      const params = new URLSearchParams();
      if (bizCtx.activeBusiness?.id) params.set('businessId', bizCtx.activeBusiness.id);
      const res = await fetch(`/api/nav/alerts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch { /* silent */ }
  }, [status, bizCtx.activeBusiness?.id]);

  useEffect(() => {
    fetchAlerts();
    // Refresh badges every 60 seconds
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Nav active helpers
  const isNavActive = (base: string) => {
    if (base === '/dashboard' && pathname === '/dashboard') return true;
    if (base === '/dashboard') return false;
    return pathname?.startsWith(base) ?? false;
  };

  const navCls = (base: string) =>
    `relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isNavActive(base) ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  const isAuthenticated = status === 'authenticated';

  return (
    <>
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-700 transition-colors">
              <Rocket className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900 hidden sm:inline">Launch <span className="text-blue-600">OS</span></span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {isAuthenticated && (
              <>
                {/* Business Selector */}
                <BusinessSelector bizCtx={bizCtx} />

                {/* Search */}
                <Link href="/search" className={navCls('/search')}>
                  <Search className="w-4 h-4" />
                  <span className="hidden xl:inline">Search</span>
                </Link>

                {/* Create Dropdown */}
                <Dropdown
                  trigger={
                    <div className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 hover:bg-gray-100 hover:text-gray-900`}>
                      <Plus className="w-4 h-4" />
                      Create
                      <ChevronDown className="w-3 h-3" />
                      <AlertBadge count={alerts.create.count} severity={alerts.create.severity} />
                    </div>
                  }
                  width="w-72"
                >
                  <DropdownSection title="Social Post">
                    <DropdownItem href="/dashboard/social?action=scout" icon={Zap} label="Scout Story" desc="AI finds local news for posts" />
                    <DropdownItem href="/dashboard/social?action=tip" icon={Lightbulb} label="Weekly Tip" desc="Share expertise with your audience" />
                    <DropdownItem href="/dashboard/social?action=draft" icon={PenLine} label="My Own Post" desc="Polish your own draft" />
                    <DropdownItem href="/dashboard/social?action=carousel" icon={Layers} label="Article Carousel" desc="Multi-slide post from article" />
                  </DropdownSection>
                  <DropdownDivider />
                  <DropdownSection title="Website Content">
                    <DropdownItem href="/dashboard/website" icon={Globe} label="New Page" desc="Add a page to your website" disabled />
                    <DropdownItem href="/dashboard/website" icon={Layout} label="Landing Page" disabled />
                    <DropdownItem href="/dashboard/website" icon={Wrench} label="Service Page" disabled />
                    <DropdownItem href="/dashboard/website" icon={BookOpen} label="Blog / Article" disabled />
                  </DropdownSection>
                  <DropdownDivider />
                  <DropdownSection title="Ad Creative">
                    <DropdownItem href="/search" icon={Target} label="Google Ad" desc="Search ad copy" disabled />
                    <DropdownItem href="/search" icon={Megaphone} label="Facebook Ad" disabled />
                    <DropdownItem href="/search" icon={ImageIcon} label="Display Image" disabled />
                    <DropdownItem href="/search" icon={Video} label="Video Concept" disabled />
                  </DropdownSection>
                  <DropdownDivider />
                  <DropdownItem href="/dashboard/social" icon={Mail} label="Email Campaign" disabled />
                  <DropdownItem href="/dashboard/social" icon={Upload} label="Upload Source / Brief" disabled />
                </Dropdown>

                {/* Social */}
                <Link href="/dashboard/social" className={navCls('/dashboard/social')}>
                  <Newspaper className="w-4 h-4" />
                  Social
                  <AlertBadge count={alerts.social.count} severity={alerts.social.severity} />
                </Link>

                {/* Website */}
                <Link href="/dashboard/website" className={navCls('/dashboard/website')}>
                  <Globe className="w-4 h-4" />
                  Website
                  <AlertBadge count={alerts.website.count} severity={alerts.website.severity} />
                </Link>

                {/* SEO */}
                <Link href="/dashboard/seo" className={navCls('/dashboard/seo')}>
                  <Compass className="w-4 h-4" />
                  SEO
                  <AlertBadge count={alerts.seo.count} severity={alerts.seo.severity} />
                </Link>

                {/* Insights */}
                <Link href="/dashboard/insights" className={navCls('/dashboard/insights')}>
                  <BarChart3 className="w-4 h-4" />
                  Insights
                  <AlertBadge count={alerts.insights.count} severity={alerts.insights.severity} />
                </Link>

                {/* Account Dropdown */}
                <Dropdown
                  trigger={
                    <div className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 hover:bg-gray-100 hover:text-gray-900`}>
                      <Settings className="w-4 h-4" />
                      Account
                      <ChevronDown className="w-3 h-3" />
                      <AlertBadge count={alerts.account.count} severity={alerts.account.severity} />
                    </div>
                  }
                  align="right"
                  width="w-56"
                >
                  <DropdownItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" desc="Business overview" />
                  <DropdownItem href="/dashboard/assets" icon={ImageIcon} label="Brand Assets" desc="Logos, images, assets" />
                  <DropdownItem href="/dashboard/credits" icon={CreditCard} label="Billing / Credits" />
                  <DropdownItem href="/dashboard/feeds" icon={BookOpen} label="Content Feeds" desc="RSS & content sources" />
                  {isAdmin && (
                    <>
                      <DropdownDivider />
                      <DropdownItem href="/admin" icon={Shield} label="Admin" desc="System administration" />
                    </>
                  )}
                  <DropdownDivider />
                  <DropdownItem
                    icon={LogOut}
                    label="Sign Out"
                    onClick={() => signOut({ callbackUrl: '/' })}
                  />
                </Dropdown>
              </>
            )}
            {!isAuthenticated && status !== 'loading' && (
              <>
                <Link href="/search" className={navCls('/search')}>
                  <Search className="w-4 h-4" /> Find Businesses
                </Link>
                <Link href="/login" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                  <LogIn className="w-4 h-4" /> Sign In
                </Link>
              </>
            )}
          </nav>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="lg:hidden bg-white border-t border-gray-100 px-4 py-3 space-y-1 max-h-[80vh] overflow-y-auto">
            {isAuthenticated ? (
              <>
                {/* Mobile Business Selector */}
                <div className="mb-3 pb-3 border-b border-gray-100">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 px-1">Current Business</div>
                  {bizCtx.businesses.map((biz) => {
                    const isActive = biz.id === bizCtx.activeBusiness?.id;
                    return (
                      <button
                        key={biz.id}
                        onClick={() => { bizCtx.setActiveBusiness(biz); }}
                        className={`flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm transition-colors ${
                          isActive ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Building2 className="w-4 h-4" />
                        <span className="truncate">{biz.businessName || biz.businessDomain}</span>
                        {isActive && <CheckCircle className="w-3.5 h-3.5 text-blue-600 ml-auto" />}
                      </button>
                    );
                  })}
                </div>

                {/* Mobile nav links */}
                <MobileNavLink href="/dashboard" icon={LayoutDashboard} label="Dashboard" pathname={pathname} onClick={() => setMobileOpen(false)} />
                <MobileNavLink href="/dashboard/social" icon={Newspaper} label="Social" pathname={pathname} badge={alerts.social} onClick={() => setMobileOpen(false)} />
                <MobileNavLink href="/dashboard/website" icon={Globe} label="Website" pathname={pathname} badge={alerts.website} onClick={() => setMobileOpen(false)} />
                <MobileNavLink href="/dashboard/seo" icon={Compass} label="SEO" pathname={pathname} badge={alerts.seo} onClick={() => setMobileOpen(false)} />
                <MobileNavLink href="/dashboard/insights" icon={BarChart3} label="Insights" pathname={pathname} badge={alerts.insights} onClick={() => setMobileOpen(false)} />

                <div className="border-t border-gray-100 my-2 pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 px-1">Social</div>
                  <MobileNavLink href="/dashboard/social" icon={Newspaper} label="Post Queue" pathname={pathname} onClick={() => setMobileOpen(false)} exact />
                  <MobileNavLink href="/dashboard/social/publishing" icon={ArrowUpRight} label="Publish Queue" pathname={pathname} onClick={() => setMobileOpen(false)} />
                  <MobileNavLink href="/dashboard/social/schedule" icon={Target} label="Schedule" pathname={pathname} onClick={() => setMobileOpen(false)} />
                  <MobileNavLink href="/dashboard/feeds" icon={BookOpen} label="Content Feeds" pathname={pathname} onClick={() => setMobileOpen(false)} />
                </div>

                <div className="border-t border-gray-100 my-2 pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 px-1">Account</div>
                  <MobileNavLink href="/dashboard/assets" icon={ImageIcon} label="Brand Assets" pathname={pathname} onClick={() => setMobileOpen(false)} />
                  <MobileNavLink href="/dashboard/credits" icon={CreditCard} label="Billing / Credits" pathname={pathname} onClick={() => setMobileOpen(false)} />
                  <MobileNavLink href="/search" icon={Search} label="Find Businesses" pathname={pathname} onClick={() => setMobileOpen(false)} />
                  {isAdmin && <MobileNavLink href="/admin" icon={Shield} label="Admin" pathname={pathname} onClick={() => setMobileOpen(false)} />}
                </div>

                <div className="border-t border-gray-100 pt-2">
                  <button
                    onClick={() => { signOut({ callbackUrl: '/' }); setMobileOpen(false); }}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </>
            ) : (
              <>
                <MobileNavLink href="/search" icon={Search} label="Find Businesses" pathname={pathname} onClick={() => setMobileOpen(false)} />
                <Link
                  href="/login"
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
                  onClick={() => setMobileOpen(false)}
                >
                  <LogIn className="w-4 h-4" /> Sign In
                </Link>
              </>
            )}
          </div>
        )}
      </header>
    </>
  );
}

// ── Mobile Nav Link ──────────────────────────────────────────────────────────
function MobileNavLink({ href, icon: Icon, label, pathname, badge, onClick, exact }: {
  href: string;
  icon: React.ElementType;
  label: string;
  pathname: string | null;
  badge?: { count: number; severity: BadgeSeverity };
  onClick?: () => void;
  exact?: boolean;
}) {
  const isActive = exact ? pathname === href : (pathname?.startsWith(href) ?? false);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
        isActive ? 'bg-blue-600 text-white font-medium' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{label}</span>
      {badge && badge.count > 0 && (
        <span className={`min-w-[20px] h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 ${
          badge.severity === 'red' ? 'bg-red-100 text-red-700' :
          badge.severity === 'amber' ? 'bg-amber-100 text-amber-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {badge.count > 9 ? '9+' : badge.count}
        </span>
      )}
    </Link>
  );
}
