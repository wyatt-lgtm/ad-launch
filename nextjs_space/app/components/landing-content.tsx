'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, ArrowRight, Loader2, AlertCircle, Sparkles, ChevronRight, ChevronDown,
  Building2, Newspaper, CalendarHeart, Rocket, Search, FileText, Share2,
  Monitor, Users, Shield, CheckCircle2, Zap, BarChart3, Layout, Megaphone,
  Settings, Link2, Eye, Lock, MessageSquare, TrendingUp, Target, Briefcase,
  MapPin, Wrench, Wifi, Heart, Car, Landmark, CircleDot,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

/* ─── Section wrapper for consistent spacing ─── */
function Section({ id, children, className = '', dark = false }: { id: string; children: React.ReactNode; className?: string; dark?: boolean }) {
  return (
    <section id={id} className={`py-16 md:py-24 ${dark ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'} ${className}`}>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6">{children}</div>
    </section>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-12 text-center">
      <h2 className="text-3xl sm:text-4xl font-bold mb-4">{title}</h2>
      {subtitle && <p className="text-lg max-w-3xl mx-auto leading-relaxed opacity-80">{subtitle}</p>}
    </div>
  );
}

function ServiceCard({ icon: Icon, title, children, badge }: { icon: any; title: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 h-full">
      <div className="flex items-start gap-4 mb-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          {badge && <span className="inline-block mt-1 text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">{badge}</span>}
        </div>
      </div>
      <div className="text-gray-600 text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200 py-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start justify-between text-left gap-4">
        <span className="font-semibold text-gray-900">{q}</span>
        <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="mt-3 text-gray-600 text-sm leading-relaxed">{a}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN LANDING CONTENT
   ═══════════════════════════════════════════════════════════════ */
export default function LandingContent() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = url?.trim() ?? '';
    if (!trimmed) { setError('Please enter a website URL'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Failed to analyze website'); setLoading(false); return; }
      if (data?.analysisId) {
        if (data.scrapedAddress) sessionStorage.setItem(`scraped_${data.analysisId}`, JSON.stringify(data.scrapedAddress));
        if (data.places?.length > 0) sessionStorage.setItem(`places_${data.analysisId}`, JSON.stringify(data.places));
        router.push(`/analyze/${data.analysisId}`);
      } else { setError('Unexpected response. Please try again.'); setLoading(false); }
    } catch { setError('Something went wrong. Please try again.'); setLoading(false); }
  };

  return (
    <main className="flex-1">
      {/* ═══════════════  1. HERO  ═══════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        </div>
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-24 pb-28 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-white/10 text-blue-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6 backdrop-blur-sm border border-white/10">
              <Sparkles className="w-4 h-4" /> The AI-Powered Local Marketing Operating System
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
              Launch OS
              <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent block mt-2">
                The Local Marketing Operating System
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed">
              Launch OS is the AI-powered local marketing operating system for websites, SEO, social, CRM, and ads. It turns a business website, location, offers, and local market signals into ready-to-approve websites, social posts, SEO pages, CRM forms, and scheduled social publishing.
            </p>
          </motion.div>

          {/* URL Input */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
            <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
              <div className="relative flex items-center bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 hover:border-blue-400/40 transition-all focus-within:border-blue-400/60 overflow-hidden">
                <div className="pl-5"><Globe className="w-5 h-5 text-slate-400" /></div>
                <input type="text" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} placeholder="yourwebsite.com" className="flex-1 px-4 py-4 bg-transparent outline-none text-white placeholder-slate-500 text-base" disabled={loading} />
                <button type="submit" disabled={loading} className="m-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition-all disabled:opacity-50 flex items-center gap-2 text-sm whitespace-nowrap shadow-lg shadow-blue-600/25">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {loading ? 'Analyzing…' : 'Start Your Launch'}
                </button>
              </div>
              {error && <div className="mt-3 flex items-center gap-2 text-red-400 text-sm justify-center"><AlertCircle className="w-4 h-4" /> {error}</div>}
            </form>
            <p className="text-center text-sm text-slate-500 mt-4">No signup required · See what Launch OS can build for your business</p>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════  2. WHAT LAUNCH CONNECT DOES  ═══════════════ */}
      <Section id="what-it-does">
        <SectionHeading
          title="What Launch OS Does"
          subtitle="Launch OS by Launch Marketing brings together website generation, SEO content, social post creation, CRM management, and social publishing into a single AI-powered platform designed for local businesses and the agencies that serve them."
        />
        <div className="grid md:grid-cols-2 gap-6 text-gray-700 leading-relaxed">
          <div>
            <p className="mb-4">Instead of juggling separate tools for website building, social media scheduling, SEO optimization, CRM management, and campaign reporting, Launch OS provides one command center where all these capabilities are connected.</p>
            <p>The platform analyzes your existing business website, understands your services, location, offers, and competitive landscape, then generates ready-to-approve marketing assets across every channel.</p>
          </div>
          <div>
            <p className="mb-4">Launch OS is powered by Tombstone, an AI orchestration engine that coordinates multiple specialized AI agents — each responsible for a different aspect of marketing: research, copywriting, creative direction, image generation, SEO analysis, and publishing.</p>
            <p>Every piece of generated content passes through quality gates and approval workflows before it reaches your audience.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  3. CORE SERVICES  ═══════════════ */}
      <Section id="core-services" className="bg-gray-50">
        <SectionHeading
          title="What Launch OS Can Do"
          subtitle="A comprehensive suite of AI-powered services that cover the full local marketing lifecycle — from website creation to social publishing to campaign reporting."
        />
        <div className="grid md:grid-cols-2 gap-6">
          {/* 3a – Website concept generation */}
          <ServiceCard icon={Monitor} title="Website Concept Generation">
            <p>Launch OS analyzes your business website to understand your brand, services, offers, and positioning. You can add up to 3 competitor websites for competitive analysis.</p>
            <p>The system reviews competitor SEO performance, offers, positioning, CTAs, trust signals, important pages, and performs SWOT analysis. It then creates 3 distinct website concepts.</p>
            <p>These concepts are evaluated through a Creative War Room process that selects the strongest direction. The winning concept becomes a site blueprint ready for WordPress deployment.</p>
          </ServiceCard>

          {/* 3b – WordPress preview deployment */}
          <ServiceCard icon={Layout} title="WordPress Site Preview Deployment">
            <p>Launch OS deploys live preview websites using WordPress so you can see exactly what your new site will look like before going live.</p>
            <p>Preview sites are deployed for review and refinement before final approval. The intended preview domain will be preview.launchmarketing.com. The geoprofit.ai domain may be used as current deployment infrastructure.</p>
            <p>This allows business owners and agencies to review, request changes, and approve the site before it becomes the live website.</p>
          </ServiceCard>

          {/* 3c – SEO page generation */}
          <ServiceCard icon={Search} title="SEO Page Generation">
            <p>The SEO workflow follows a structured pipeline: keyword and search intent brief, site inventory and duplicate check, SEO copy drafting, conversion review, final SEO quality assurance, and WordPress publishing through Gutenberg.</p>
            <p>Quality gates prevent thin content, duplicate pages, doorway pages, and keyword-stuffed copy. Each page is checked for relevance, uniqueness, and value before publishing.</p>
          </ServiceCard>

          {/* 3d – Social post generation */}
          <ServiceCard icon={Share2} title="Social Post Generation">
            <p>Launch OS turns your business website content, offers, services, local context, and news signals into ready-to-approve social media posts.</p>
            <p>The system supports multiple post lanes: website/business posts drawn from your site content, evergreen/offer posts highlighting your services and promotions, and local news posts connecting community events to your business.</p>
            <p>Each post package includes copy, media direction, a call-to-action, and an optional supporting webpage for deeper engagement.</p>
          </ServiceCard>

          {/* 3e – Local news / Scout content */}
          <ServiceCard icon={Newspaper} title="Local News &amp; Scout Content">
            <p>The Scout system monitors local news sources and RSS feeds to identify stories and events relevant to your community and business.</p>
            <p>When appropriate, it connects relevant local issues and events to your business — building local relevance and community engagement without forcing unrelated connections.</p>
            <p>Local news content does not block other post lanes. If news enrichment is slow, the system uses fallback metadata to keep other content flowing.</p>
          </ServiceCard>

          {/* 3f – Supporting pages */}
          <ServiceCard icon={FileText} title="Supporting Pages for Social Posts">
            <p>Eligible social posts can generate a detailed supporting webpage that expands on the post content. These pages are useful for SEO value, retargeting campaigns, conversion optimization, and customer education.</p>
            <p>Not every lightweight post gets a supporting page — only posts with enough substance warrant one. Pages are quality-gated to prevent thin or low-value content from being published.</p>
          </ServiceCard>

          {/* 3g – Launch CRM provisioning */}
          <ServiceCard icon={Settings} title="Launch CRM Provisioning">
            <p>Launch OS can create or link a Launch CRM workspace for each business. The agency credential is used only for initial provisioning and setup.</p>
            <p>Once provisioned, a sub-account credential handles all business-specific operations. The system stores the location ID and setup status, and supports lead forms, custom fields, contact management, and future workflow automations.</p>
          </ServiceCard>

          {/* 3h – Social Planner publishing */}
          <ServiceCard icon={Megaphone} title="Social Planner Publishing">
            <p>Launch OS uses Launch CRM's Social Planner as the social publishing rail. This approach leverages existing social account connections rather than building direct Facebook, Instagram, or LinkedIn posting integrations.</p>
            <p>Approved posts can be scheduled or published through the Social Planner when social accounts are connected. Posts for unconnected accounts are held as pending until the connection is made.</p>
            <p>User approval settings control whether posts are auto-scheduled or require manual approval before publishing.</p>
          </ServiceCard>

          {/* 3i – Facebook / social connection */}
          <ServiceCard icon={Link2} title="Facebook &amp; Social Account Connection">
            <p>Business owners connect or authorize their social media accounts through the Launch CRM Social Planner interface. Launch OS tracks the connection status for each social account.</p>
            <p>Posts are held until the relevant social account is connected — nothing publishes to an unconnected account. Launch OS never asks for Facebook passwords or stores social media login credentials directly.</p>
          </ServiceCard>

          {/* 3j – Customer approval workflow */}
          <ServiceCard icon={Eye} title="Customer Approval Workflow">
            <p>Content is generated automatically, but publishing is approval-gated by default. Business owners and authorized users can approve, reject, edit, or request changes to any generated content.</p>
            <p>Auto-publish can be enabled only after the business owner gives explicit permission. These approval gates protect brand consistency and content accuracy.</p>
          </ServiceCard>

          {/* 3k – Google Ads */}
          <ServiceCard icon={BarChart3} title="Google Ads Campaign Management &amp; Reporting" badge="Being Built">
            <p>Launch OS is being built to help local businesses and agencies monitor Google Ads performance and connect campaign data to website performance, CRM outcomes, and content/SEO opportunities.</p>
            <p>Planned capabilities include: Google Ads account connection through agency/MCC-style management, campaign performance dashboards, weekly campaign summaries, anomaly detection for metrics outside expected ranges.</p>
            <p>Key metrics: CPC, impressions, clicks, conversions, conversion rate, cost per conversion, impression share, and budget pacing. The system is designed to provide approval-gated campaign change recommendations, landing page and SEO recommendations based on ad performance, and client-facing summaries written in plain English.</p>
            <p>Agency management views will support monitoring multiple local business accounts from a single dashboard. Reporting is designed to connect ads, website pages, social posts, CRM forms, and leads into one unified view.</p>
          </ServiceCard>
        </div>
      </Section>

      {/* ═══════════════  4. HOW THE WORKFLOW WORKS  ═══════════════ */}
      <Section id="how-it-works">
        <SectionHeading
          title="How the Workflow Works"
          subtitle="Launch OS coordinates multiple AI agents behind the scenes. Here is what happens when you bring a business onto the platform."
        />
        <div className="grid gap-4">
          {[
            { step: '1', title: 'Website Analysis', desc: 'The system scrapes and analyzes your business website to understand services, offers, brand voice, location, and positioning.' },
            { step: '2', title: 'Competitor Research', desc: 'If competitor websites are provided, the system reviews their SEO, offers, CTAs, trust signals, and strengths/weaknesses.' },
            { step: '3', title: 'Concept Generation', desc: 'Multiple website concepts are generated and evaluated through a Creative War Room to select the strongest direction.' },
            { step: '4', title: 'Preview Deployment', desc: 'The winning concept is deployed as a live WordPress preview site for review and approval.' },
            { step: '5', title: 'Social Content Creation', desc: 'AI agents generate social post packages across multiple content lanes — business, evergreen, and local news.' },
            { step: '6', title: 'Supporting Page Generation', desc: 'Eligible posts get detailed supporting webpages for SEO value and deeper customer engagement.' },
            { step: '7', title: 'SEO Page Pipeline', desc: 'Keyword-targeted SEO pages are drafted, reviewed for quality, and published through WordPress/Gutenberg.' },
            { step: '8', title: 'CRM Setup', desc: 'A Launch CRM workspace is created or linked, with forms, contacts, and social publishing connections configured.' },
            { step: '9', title: 'Social Account Connection', desc: 'The business connects their Facebook, Instagram, or Google Business Profile through the CRM Social Planner.' },
            { step: '10', title: 'Approval & Publishing', desc: 'Approved content is scheduled and published through the Social Planner. Campaign monitoring and reporting continue over time.' },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-4 bg-gray-50 rounded-xl p-5">
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">{item.step}</div>
              <div>
                <h4 className="font-bold text-gray-900 mb-1">{item.title}</h4>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  5-6. WEBSITE GENERATION + SOCIAL POST DETAIL  ═══════════════ */}
      <Section id="website-generation" className="bg-gray-50">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-4">Website Generation</h2>
            <p className="text-gray-600 mb-3">Launch OS doesn't just analyze websites — it generates new ones. The process starts with a deep analysis of your current site and up to 3 competitor sites.</p>
            <p className="text-gray-600 mb-3">Three distinct website concepts are created, each with different strategic approaches to positioning, layout, messaging, and conversion optimization.</p>
            <p className="text-gray-600 mb-3">The Creative War Room evaluates each concept on criteria including clarity of value proposition, competitive differentiation, trust signals, call-to-action effectiveness, and mobile experience.</p>
            <p className="text-gray-600">The winning concept is transformed into a full site blueprint and deployed as a live WordPress preview for business owner review.</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-4">Social Post Generation &amp; Approval</h2>
            <p className="text-gray-600 mb-3">Every social post goes through a multi-agent pipeline. First, the business context is analyzed. Then specialized agents handle copywriting, creative direction, and image generation independently.</p>
            <p className="text-gray-600 mb-3">Posts are organized into lanes: website/business content, evergreen offers, and local news/community posts. Each lane can run independently, so a slow news lookup doesn't block your business posts.</p>
            <p className="text-gray-600 mb-3">Generated posts include polished copy, AI-generated imagery with text overlays, calls-to-action, and optional supporting webpages.</p>
            <p className="text-gray-600">Nothing publishes without approval unless the business explicitly enables auto-scheduling.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  7. LOCAL NEWS / SCOUT  ═══════════════ */}
      <Section id="local-news">
        <SectionHeading
          title="Local News &amp; Community Content"
          subtitle="The Scout system continuously monitors local news sources, RSS feeds, and community events to find stories that matter to your business and your customers."
        />
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-xl p-6">
            <h4 className="font-bold text-gray-900 mb-2">Local Relevance</h4>
            <p className="text-gray-600 text-sm">Scout identifies news stories and events in your community that connect naturally to your business, building local authority and engagement.</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-6">
            <h4 className="font-bold text-gray-900 mb-2">Non-Blocking Workflow</h4>
            <p className="text-gray-600 text-sm">Local news content runs as an independent lane. If enrichment is slow or no relevant news is found, your other post types keep flowing.</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-6">
            <h4 className="font-bold text-gray-900 mb-2">Quality-Gated</h4>
            <p className="text-gray-600 text-sm">Not every news story gets turned into a post. Only stories with genuine relevance to the business and its audience make the cut.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  8-9. SEO + SUPPORTING PAGES  ═══════════════ */}
      <Section id="seo-pages" className="bg-gray-50">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-4">SEO Page Generation</h2>
            <p className="text-gray-600 mb-3">The SEO pipeline starts with keyword research and search intent analysis, then checks your existing site inventory to avoid duplicating content you already have.</p>
            <p className="text-gray-600 mb-3">Copy is drafted with conversion optimization in mind, reviewed for quality, and put through final SEO QA before publishing to WordPress through the Gutenberg editor.</p>
            <p className="text-gray-600">Quality gates prevent thin content, duplicate pages, doorway pages, keyword stuffing, and pages that don't provide genuine value to searchers. Geo-reference data does not automatically generate location doorway pages.</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-4">Supporting Webpages for Social Posts</h2>
            <p className="text-gray-600 mb-3">When a social post warrants deeper engagement, Launch OS can generate a detailed supporting webpage that expands on the post topic.</p>
            <p className="text-gray-600 mb-3">These pages serve multiple purposes: they provide SEO value through additional indexed content, create retargeting opportunities, support conversion funnels, and educate potential customers.</p>
            <p className="text-gray-600">Not every post gets a supporting page — lightweight or promotional posts may not need one. Pages go through the same quality gates as other content to ensure they add genuine value.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  10-11. WORDPRESS + LAUNCH CRM  ═══════════════ */}
      <Section id="wordpress-ghl">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-4">WordPress Preview Deployment</h2>
            <p className="text-gray-600 mb-3">Launch OS uses WordPress as the website deployment platform. Generated website concepts are deployed as live preview sites that business owners can review in their browser.</p>
            <p className="text-gray-600 mb-3">Preview sites let you see exactly what the generated website looks like, navigate through pages, check mobile responsiveness, and request changes before anything goes live.</p>
            <p className="text-gray-600">The preview infrastructure currently uses the geoprofit.ai domain. The intended preview domain will be preview.launchmarketing.com as the platform matures.</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-4">Launch CRM Provisioning</h2>
            <p className="text-gray-600 mb-3">Launch OS uses Launch CRM to manage forms, contacts, and social publishing for each business.</p>
            <p className="text-gray-600 mb-3">When a business is onboarded, Launch OS can create a new CRM sub-account or link to an existing one. The agency credential is used only for initial provisioning — all business-specific operations use the sub-account credential.</p>
            <p className="text-gray-600">The CRM workspace supports lead capture forms, custom fields, contact management, social account connections, and is designed for future workflow automations.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  12-13. SOCIAL PLANNER + FACEBOOK  ═══════════════ */}
      <Section id="social-publishing" className="bg-gray-50">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-4">Social Planner Publishing</h2>
            <p className="text-gray-600 mb-3">Rather than building direct integrations with every social platform, Launch OS publishes through Launch CRM's Social Planner. This approach leverages the business's existing social account connections.</p>
            <p className="text-gray-600 mb-3">When a post is approved, it's scheduled through the Social Planner for the connected social accounts. Posts for accounts that haven't been connected yet are held in a pending state.</p>
            <p className="text-gray-600">Businesses can configure whether approved posts are automatically scheduled or require manual publishing confirmation.</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-4">Facebook &amp; Social Account Connection</h2>
            <p className="text-gray-600 mb-3">Social account connections happen through the Launch CRM Social Planner interface. Business owners authorize their Facebook Pages, Instagram accounts, or Google Business Profiles directly through the CRM.</p>
            <p className="text-gray-600 mb-3">Launch OS tracks the connection status for each social account. Posts targeting unconnected accounts are held — nothing publishes to an account that hasn't been authorized.</p>
            <p className="text-gray-600">Launch OS never asks for your Facebook password or any social media login credentials. All authentication happens through the official connection flow in the CRM platform.</p>
          </div>
        </div>
      </Section>

      {/* ═══════════════  14. CUSTOMER JOURNEY  ═══════════════ */}
      <Section id="customer-journey">
        <SectionHeading
          title="The Customer Journey"
          subtitle="From first visit to ongoing marketing — here is how a business moves through the Launch OS platform."
        />
        <div className="space-y-3">
          {[
            'Business registers at connect.launchmarketing.com and enters their website URL and location.',
            'Launch OS analyzes the business website, extracting services, offers, brand voice, and positioning.',
            'Optional competitor websites are added for competitive analysis — SEO, offers, CTAs, and SWOT.',
            'Launch OS generates 3 website concepts. The Creative War Room selects the strongest direction.',
            'A preview site is deployed on WordPress for business owner review and approval.',
            'Social posts are generated across multiple content lanes — business, evergreen, and local news.',
            'Supporting webpages are created for posts that warrant deeper content.',
            'SEO pages are drafted, quality-checked, and published to grow organic search presence.',
            'A Launch CRM workspace is created or linked, with forms and contact management configured.',
            'The business connects their Facebook, Instagram, or Google Business Profile through the CRM Social Planner.',
            'Approved posts are scheduled and published through the Social Planner.',
            'Launch OS monitors Google Ads performance, flags unusual campaign movement, summarizes what changed, and recommends landing page, SEO, content, or campaign actions for approval.',
            'SEO pages, website improvements, social content, and campaign optimizations continue over time.',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 py-2">
              <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
              <p className="text-gray-700 text-sm">{step}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  15. INTEGRATIONS  ═══════════════ */}
      <Section id="integrations" className="bg-gray-50">
        <SectionHeading
          title="Integrations"
          subtitle="Launch OS brings together multiple platforms and services into one unified marketing workflow."
        />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { name: 'WordPress', desc: 'Website deployment, preview hosting, and SEO page publishing through Gutenberg.' },
            { name: 'Launch CRM', desc: 'CRM workspace provisioning, contact management, forms, and workflow automations.' },
            { name: 'Social Planner', desc: 'Social media scheduling and publishing rail for approved content.' },
            { name: 'Facebook Pages', desc: 'Publish approved posts to connected Facebook Pages through the Social Planner.' },
            { name: 'Instagram', desc: 'Publish approved posts to connected Instagram accounts through the Social Planner, where supported.' },
            { name: 'Google Business Profile', desc: 'Publish approved posts to Google Business Profile through the Social Planner, where supported.' },
            { name: 'RSS / Local News Feeds', desc: 'Monitor local news sources and community events for Scout content generation.' },
            { name: 'AI / LLM Workflows', desc: 'Multiple specialized AI agents handle research, copywriting, creative direction, image generation, and quality review.' },
            { name: 'Tombstone API', desc: 'The AI orchestration engine that coordinates all agents, workflows, and publishing pipelines.' },
            { name: 'WordPress Preview Hosting', desc: 'Preview site deployment for business owner review before final launch.' },
            { name: 'LaunchMarketing.com Domains', desc: 'Platform domains for connect, preview, and marketing portal access.' },
            { name: 'Google Ads', desc: 'Campaign performance reporting, anomaly detection, and approval-gated recommendations (being built).' },
            { name: 'Google Ads MCC', desc: 'Manager account-style reporting for agencies overseeing multiple client ad accounts (planned).' },
            { name: 'CRM Lead Tracking', desc: 'Connect ad performance and website conversions to CRM lead capture and form submissions.' },
          ].map((item) => (
            <div key={item.name} className="bg-white border border-gray-200 rounded-xl p-4">
              <h4 className="font-semibold text-gray-900 text-sm mb-1">{item.name}</h4>
              <p className="text-gray-500 text-xs">{item.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  16. USE CASES  ═══════════════ */}
      <Section id="use-cases">
        <SectionHeading
          title="Use Cases"
          subtitle="Launch OS is built for the real challenges local businesses and agencies face every day."
        />
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { icon: Building2, title: 'Launch a Better Website', desc: 'A local service business needs a modern, high-converting website but doesn\'t have a designer or developer on staff.' },
            { icon: Share2, title: 'Social Posts from Your Website', desc: 'A business has a website but no social media presence. Launch OS turns existing content into ready-to-approve posts.' },
            { icon: Newspaper, title: 'Local News &amp; Community Posts', desc: 'A business wants to connect with the local community through timely, relevant content tied to local events and news.' },
            { icon: Search, title: 'SEO Pages &amp; Supporting Content', desc: 'A business needs to grow organic search traffic with targeted SEO pages and supporting content for social campaigns.' },
            { icon: Users, title: 'Agency Managing Multiple Clients', desc: 'A marketing agency needs to manage websites, social content, SEO, and CRM for multiple local business clients from one platform.' },
            { icon: Settings, title: 'Connected CRM, Forms &amp; Publishing', desc: 'A business wants their CRM, lead forms, social publishing, and website all connected and coordinated.' },
            { icon: Eye, title: 'Website Previews Before Launch', desc: 'A business wants to see and approve exactly what their new website will look like before it goes live.' },
            { icon: Target, title: 'Competitor-Informed Redesign', desc: 'A business wants a new website that is informed by what competitors are doing well — and what they are missing.' },
            { icon: BarChart3, title: 'Google Ads Reporting for Agencies', desc: 'An agency managing Google Ads for multiple local clients needs simple performance reports and anomaly alerts.' },
            { icon: TrendingUp, title: 'Campaign Performance Alerts', desc: 'A business wants to know when ad costs spike, conversions drop, or campaign metrics move outside expected ranges.' },
            { icon: Zap, title: 'AI-Assisted Ad Recommendations', desc: 'A campaign manager needs AI-assisted recommendations before making changes to Google Ads campaigns.' },
            { icon: Link2, title: 'Ad-to-Landing-Page Connection', desc: 'A business wants ad performance connected to landing pages, CRM leads, and social/SEO content for smarter decisions.' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-4 bg-gray-50 rounded-xl p-5">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <item.icon className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">{item.title}</h4>
                <p className="text-gray-600 text-xs">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  17. WHO IT IS FOR  ═══════════════ */}
      <Section id="who-its-for" className="bg-gray-50">
        <SectionHeading
          title="Who Launch OS Is For"
          subtitle="Designed for local businesses, agencies, and multi-location operators who need website, SEO, social, CRM, and campaign management connected in one platform."
        />
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Wrench, label: 'Trades &amp; Home Services', examples: 'Plumbers, electricians, HVAC, roofers, landscapers, general contractors' },
            { icon: Car, label: 'Auto Repair &amp; Service', examples: 'Auto shops, tire centers, collision repair, detailing services' },
            { icon: Wifi, label: 'Rural Internet &amp; Telecom', examples: 'Fixed wireless ISPs, fiber providers, rural broadband, telecom companies' },
            { icon: Heart, label: 'Healthcare &amp; Professional Services', examples: 'Dental offices, chiropractors, veterinarians, law firms, accountants' },
            { icon: MapPin, label: 'Local Service Businesses', examples: 'Restaurants, salons, fitness studios, cleaning services, pest control' },
            { icon: Users, label: 'Marketing Agencies', examples: 'Agencies serving multiple local business clients who need scalable marketing operations' },
            { icon: Building2, label: 'Franchises &amp; Multi-Location', examples: 'Franchise operators, multi-location businesses needing consistent marketing across sites' },
            { icon: Briefcase, label: 'Small Business Owners', examples: 'Any local business that needs social, SEO, website, and CRM connected without hiring a full marketing team' },
          ].map((item) => (
            <div key={item.label} className="bg-white border border-gray-200 rounded-xl p-5 text-center">
              <item.icon className="w-8 h-8 text-blue-600 mx-auto mb-3" />
              <h4 className="font-bold text-gray-900 text-sm mb-2">{item.label}</h4>
              <p className="text-gray-500 text-xs">{item.examples}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  18. AUTOMATED VS APPROVAL-GATED  ═══════════════ */}
      <Section id="automated-vs-approval">
        <SectionHeading
          title="What Is Automated vs. Approval-Gated"
          subtitle="Launch OS automates the heavy lifting but keeps humans in control of what goes live."
        />
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Zap className="w-5 h-5 text-blue-600" /> Automated</h3>
            <ul className="space-y-2 text-gray-600 text-sm">
              {[
                'Business website analysis and content extraction',
                'Competitor website research and SWOT analysis',
                'Website concept generation and Creative War Room evaluation',
                'Social post copywriting, creative direction, and image generation',
                'Local news monitoring and relevance matching',
                'SEO keyword research and content drafting',
                'Supporting webpage generation for eligible posts',
                'CRM workspace provisioning and configuration',
                'Google Ads performance monitoring and anomaly detection (planned)',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-600" /> Approval-Gated</h3>
            <ul className="space-y-2 text-gray-600 text-sm">
              {[
                'Social post publishing — requires approval unless auto-publish is explicitly enabled',
                'Website preview approval — business reviews before going live',
                'SEO page publishing — final QA review before WordPress deployment',
                'Supporting page publishing — quality check before content goes live',
                'Google Ads campaign changes — recommendations require approval (planned)',
                'Auto-scheduling enablement — requires explicit business owner permission',
                'Social account connections — business owner authorizes through CRM',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2"><Lock className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ═══════════════  19. TRUST / SAFETY / GUARDRAILS  ═══════════════ */}
      <Section id="guardrails" className="bg-gray-50">
        <SectionHeading
          title="Trust, Safety &amp; Guardrails"
          subtitle="Launch OS is designed to protect your brand, your data, and your customers."
        />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { title: 'No Publishing Without Approval', desc: 'Social posts are not published unless approved — or unless the business explicitly enables auto-scheduling.' },
            { title: 'Content Quality Gates', desc: 'SEO pages and supporting content are checked for thin content, duplicate pages, keyword stuffing, and doorway page patterns.' },
            { title: 'No Unsupported Claims', desc: 'Generated content is blocked from making unsupported claims like guaranteed rankings, #1 placement, or unrealistic promises.' },
            { title: 'No Password Collection', desc: 'Launch OS never asks for your Facebook password or social media login credentials. All connections use official OAuth flows through the CRM.' },
            { title: 'Credential Isolation', desc: 'Agency credentials are used only for provisioning. All business-specific operations use isolated sub-account credentials. Business data is separated by business ID.' },
            { title: 'Secure Backend Services', desc: 'CRM, WordPress, and infrastructure credentials are handled by secure backend services. They are never exposed in client-side code or user-facing interfaces.' },
            { title: 'Review Before Going Live', desc: 'Website previews, social posts, SEO pages, and supporting content can all be reviewed and edited before they reach your audience.' },
            { title: 'No Automatic Doorway Pages', desc: 'Geo-reference data does not automatically generate location doorway pages. SEO pages must provide genuine value to searchers.' },
            { title: 'Approval-Gated Campaign Changes', desc: 'Google Ads campaign recommendations are designed to be approval-gated. No automatic campaign changes without explicit permission (planned).' },
          ].map((item) => (
            <div key={item.title} className="bg-white border border-gray-200 rounded-xl p-5">
              <Shield className="w-5 h-5 text-green-600 mb-2" />
              <h4 className="font-semibold text-gray-900 text-sm mb-1">{item.title}</h4>
              <p className="text-gray-500 text-xs">{item.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════  20. FAQ  ═══════════════ */}
      <Section id="faq">
        <SectionHeading title="Frequently Asked Questions" />
        <div className="max-w-3xl mx-auto">
          <FaqItem q="What is Launch OS?" a="Launch OS is an AI-powered local marketing platform by Launch Marketing. It combines website generation, SEO page creation, social post production, CRM management, social publishing, and campaign reporting into one connected system designed for local businesses and agencies." />
          <FaqItem q="Is this the same as Tombstone?" a="Tombstone is the AI orchestration engine that powers Launch OS behind the scenes. It coordinates multiple specialized AI agents that handle research, copywriting, creative direction, image generation, and publishing. Launch OS is the customer-facing platform; Tombstone is the engine that makes it work." />
          <FaqItem q="Does Launch OS replace my website?" a="It can. Launch OS generates website concepts based on your existing site and competitor analysis, then deploys a preview for your review. You approve the new site before anything replaces your current one. You can also use Launch OS alongside your existing website for social content and SEO pages." />
          <FaqItem q="Can it create a live website preview?" a="Yes. Launch OS deploys preview websites on WordPress so you can see exactly what the generated site looks like, navigate through it, and request changes before approving it." />
          <FaqItem q="Can it post to Facebook?" a="Yes, through the Launch CRM Social Planner. Once you connect your Facebook Page through the CRM, approved posts can be scheduled and published to Facebook." />
          <FaqItem q="Do I still need to connect my Facebook account?" a="Yes. You need to authorize your Facebook Page through the Launch CRM Social Planner. Launch OS generates the content, but you authorize which social accounts it can publish to." />
          <FaqItem q="Does Launch OS need my Facebook password?" a="No. Launch OS never asks for social media passwords. Social account connections use the official authorization flow through the CRM platform." />
          <FaqItem q="Can I approve posts before they publish?" a="Yes. By default, all posts require approval before publishing. Auto-scheduling can be enabled, but only after the business owner explicitly grants that permission." />
          <FaqItem q="How does Launch CRM fit into the system?" a="Launch OS uses Launch CRM for CRM features like contact management, lead forms, and social publishing. Launch CRM provides the Social Planner that handles the actual scheduling and posting to connected social accounts." />
          <FaqItem q="How does SEO page generation work?" a="The SEO pipeline includes keyword research, search intent analysis, site inventory check, copy drafting, conversion review, and final QA. Approved pages are published to WordPress through the Gutenberg editor." />
          <FaqItem q="Will it create pages for every ZIP or city?" a="No. Launch OS does not automatically generate location doorway pages. SEO pages must provide genuine value and pass quality gates before publishing. Geo-reference data informs content but does not trigger mass page generation." />
          <FaqItem q="Can I add competitor websites?" a="Yes. You can add up to 3 competitor websites. Launch OS will analyze their SEO, offers, positioning, CTAs, trust signals, and perform SWOT analysis to inform your website concept and content strategy." />
          <FaqItem q="Can I use my existing WordPress site?" a="Yes. Launch OS can publish SEO pages and content to existing WordPress sites through the Gutenberg editor. Website generation can also deploy preview sites alongside your existing site." />
          <FaqItem q="What happens if a social account is not connected?" a="Posts targeting unconnected social accounts are held in a pending state. They won't be published until the account is connected through the CRM Social Planner. You won't lose any generated content." />
          <FaqItem q="Is this for agencies or business owners?" a="Both. Business owners can use Launch OS directly for their own marketing. Agencies can use it to manage multiple local business clients, with each business having its own isolated workspace." />
          <FaqItem q="Can Launch OS manage Google Ads?" a="Launch OS is being built to support Google Ads reporting, campaign monitoring, anomaly detection, and approval-gated recommendations. The goal is to help local businesses and agencies understand what changed, what it means, and what action to take next." />
          <FaqItem q="Will it automatically change my Google Ads campaigns?" a="Campaign changes are designed to be approval-gated by default. Launch OS can recommend changes, but automatic campaign modifications only happen when the business or agency explicitly enables that setting." />
          <FaqItem q="Can it approve campaign recommendations before changes are made?" a="Yes. The platform is designed so that campaign recommendations are presented for review and approval before any changes are applied. You stay in control of your ad spend." />
          <FaqItem q="Can it explain campaign performance in plain English?" a="Yes. Launch OS is designed to generate client-facing campaign summaries written in plain English — explaining what happened, why it matters, and what to do next, without requiring you to interpret raw metrics." />
          <FaqItem q="Can it connect ad performance to website pages and lead forms?" a="Yes. The platform is designed to connect campaign performance, landing pages, CRM forms, and lead outcomes so marketing decisions are not made from ad metrics alone." />
        </div>
      </Section>

      {/* ═══════════════  21. CTA  ═══════════════ */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to Launch Your Marketing?</h2>
          <p className="text-blue-100 text-lg mb-8 max-w-2xl mx-auto">
            Enter your website URL above and see what Launch OS can build for your business — website concepts, social posts, SEO pages, and more.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex items-center gap-2 bg-white text-blue-700 px-8 py-4 rounded-xl font-bold hover:bg-blue-50 transition-all shadow-lg"
            >
              Start Your Launch <ArrowRight className="w-5 h-5" />
            </button>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 text-white border border-white/30 px-8 py-4 rounded-xl font-semibold hover:bg-white/10 transition-all"
            >
              See How It Works <ChevronDown className="w-5 h-5" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
