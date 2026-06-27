'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  Compass, TrendingUp, Search, MapPin, AlertTriangle,
  Link2, FileText, BarChart3, Users
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

const seoItems = [
  { icon: BarChart3, label: 'Overview', desc: 'SEO health dashboard and score' },
  { icon: TrendingUp, label: 'Page Scores', desc: 'Per-page SEO performance grades' },
  { icon: Search, label: 'Keywords', desc: 'Target keyword tracking and gaps' },
  { icon: MapPin, label: 'Local SEO', desc: 'Google Business, citations, NAP consistency' },
  { icon: FileText, label: 'Recommendations', desc: 'Prioritized SEO improvement actions' },
  { icon: AlertTriangle, label: 'Issues', desc: 'Broken pages, missing metadata, errors' },
  { icon: Link2, label: 'Internal Links', desc: 'Link structure and anchor text analysis' },
  { icon: Users, label: 'Community Engagement', desc: 'Reddit & specialty forum monitoring', href: '/dashboard/seo/community-engagement', active: true },
];

export default function SeoSection() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  if (status === 'loading') {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Compass className="w-6 h-6 text-blue-600" />
          SEO
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Diagnostics, recommendations, and keyword tracking for your website.
          {bizCtx.activeBusiness && (
            <span className="ml-1 text-blue-600 font-medium">— {bizCtx.activeBusiness.businessName || bizCtx.activeBusiness.businessDomain}</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {seoItems.map((item: any) => {
          const Icon = item.icon;
          const isActive = item.active;
          const Wrapper = isActive && item.href ? 'a' : 'div';
          return (
            <Wrapper
              key={item.label}
              {...(isActive && item.href ? { href: item.href } : {})}
              className={`bg-white rounded-xl border p-5 transition-all ${
                isActive
                  ? 'border-blue-300 hover:border-blue-400 hover:shadow-md cursor-pointer'
                  : 'border-gray-200 hover:border-blue-300 hover:shadow-sm cursor-default opacity-70'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isActive ? 'bg-blue-100' : 'bg-blue-50'
                }`}>
                  <Icon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">{item.label}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                </div>
              </div>
              {isActive ? (
                <div className="mt-3 text-[10px] font-medium text-green-600 bg-green-50 rounded px-2 py-1 inline-block">
                  Available
                </div>
              ) : (
                <div className="mt-3 text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
                  Coming Soon
                </div>
              )}
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}
