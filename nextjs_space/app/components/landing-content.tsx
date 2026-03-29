'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Sparkles, BarChart3, CalendarDays, Globe, Zap, Download, ChevronRight } from 'lucide-react';
import UrlInputForm from './url-input-form';

function AnimatedSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function LandingContent() {
  const features = [
    { icon: Sparkles, title: '3 Facebook Ads', description: 'AI-crafted ads based on your actual business content, not generic templates.', color: 'bg-blue-100 text-blue-600' },
    { icon: BarChart3, title: 'SEO Insights', description: 'Actionable SEO recommendations to improve your online visibility.', color: 'bg-emerald-100 text-emerald-600' },
    { icon: CalendarDays, title: '90-Day Plan', description: 'A complete posting schedule to keep your social media consistent.', color: 'bg-purple-100 text-purple-600' },
  ];

  const steps = [
    { num: '01', title: 'Enter Your URL', description: 'Paste your website address and our AI starts analyzing your business.', icon: Globe },
    { num: '02', title: 'AI Generates Ads', description: 'We scan your site, extract key content, and craft professional ads.', icon: Zap },
    { num: '03', title: 'Download Free', description: 'Register with your business email and get all assets instantly.', icon: Download },
  ];

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-white to-white">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-200/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-200/20 rounded-full blur-3xl" />
        </div>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-20 pb-24 relative z-10">
          <AnimatedSection className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" /> First 3 ads completely free
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
              Turn Your Website Into
              <span className="text-blue-600 block">High-Converting Ads</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
              Enter your website URL and get 3 professionally crafted Facebook ads, SEO insights, and a 90-day posting plan — powered by AI.
            </p>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <UrlInputForm />
          </AnimatedSection>
          <AnimatedSection delay={0.3}>
            <p className="text-center text-sm text-gray-400 mt-4">No credit card required · Business email needed to download</p>
          </AnimatedSection>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <AnimatedSection className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Everything You Need to <span className="text-blue-600">Launch</span></h2>
            <p className="text-gray-600 max-w-xl mx-auto">Get a complete marketing starter kit generated from your existing website content.</p>
          </AnimatedSection>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <AnimatedSection key={i} delay={i * 0.1}>
                <div className="bg-gray-50 rounded-2xl p-6 hover:shadow-lg transition-all group h-full">
                  <div className={`w-12 h-12 ${f.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <f.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{f.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <AnimatedSection className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Three simple steps to professional ads.</p>
          </AnimatedSection>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <AnimatedSection key={i} delay={i * 0.15}>
                <div className="relative bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
                  <span className="text-5xl font-extrabold text-blue-100 absolute top-4 right-4">{s.num}</span>
                  <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
                    <s.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{s.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 text-center">
          <AnimatedSection>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to Launch Your Ads?</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">Join hundreds of businesses already using AI to create high-converting ads.</p>
            <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="inline-flex items-center gap-2 bg-white text-blue-700 px-8 py-4 rounded-xl font-bold hover:bg-blue-50 transition-all shadow-lg">
              Get Started Free <ChevronRight className="w-5 h-5" />
            </a>
          </AnimatedSection>
        </div>
      </section>
    </main>
  );
}
