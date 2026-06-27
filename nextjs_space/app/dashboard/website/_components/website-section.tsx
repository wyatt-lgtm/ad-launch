'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  Globe, Layout, Wrench, Eye, BookOpen, FileText,
  MapPin, Bug, ArrowUpRight, Compass, Settings
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

const sections = [
  {
    title: 'Pages',
    items: [
      { icon: Layout, label: 'All Pages', desc: 'View and manage all site pages', href: '#' },
      { icon: Globe, label: 'Home Page', desc: 'Edit your homepage content', href: '#' },
      { icon: Wrench, label: 'Service Pages', desc: 'Manage service descriptions', href: '#' },
      { icon: MapPin, label: 'City & County Pages', desc: 'Local SEO landing pages', href: '#' },
      { icon: BookOpen, label: 'Blog / Articles', desc: 'Content marketing posts', href: '#' },
    ],
  },
  {
    title: 'Edit Site',
    items: [
      { icon: Eye, label: 'Visual Editor', desc: 'WYSIWYG page editing', href: '#' },
      { icon: FileText, label: 'Copy Editor', desc: 'Edit text and messaging', href: '#' },
    ],
  },
  {
    title: 'Website Generator',
    items: [
      { icon: Compass, label: 'Sitemap', desc: 'View and edit site structure', href: '#' },
      { icon: ArrowUpRight, label: 'Preview & Revisions', desc: 'Preview generated website', href: '#' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { icon: Settings, label: 'Forms & CTAs', desc: 'Manage contact forms and calls-to-action', href: '#' },
      { icon: Bug, label: 'Diagnostics', desc: 'Technical site health checks', href: '#' },
    ],
  },
];

export default function WebsiteSection() {
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
          <Globe className="w-6 h-6 text-blue-600" />
          Website
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Build, edit, revise, and publish your website content.
          {bizCtx.activeBusiness && (
            <span className="ml-1 text-blue-600 font-medium">— {bizCtx.activeBusiness.businessName || bizCtx.activeBusiness.businessDomain}</span>
          )}
        </p>
      </div>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-default opacity-70"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">{item.label}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    <div className="mt-3 text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
                      Coming Soon
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
