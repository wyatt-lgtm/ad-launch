'use client';

import { Globe, Layout, Users, Briefcase, ArrowRight, Lock, Copy, Check, Sparkles, Loader2, ExternalLink } from 'lucide-react';
import { useState } from 'react';

interface WebsiteConceptProps {
  data: any;
  locked?: boolean;
}

function CopyAll({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 transition-colors">
      {copied ? <><Check className="w-3.5 h-3.5 text-green-500" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy All</>}
    </button>
  );
}

function SectionCard({ section, icon: Icon, color }: { section: any; icon: any; color: string }) {
  const allText = [section.headline, section.description, section.cta].filter(Boolean).join('\n\n');
  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h4 className="font-semibold text-gray-900 text-sm">{section.title}</h4>
        </div>
        <CopyAll text={allText} />
      </div>
      {section.headline && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 uppercase font-medium mb-1">Headline</div>
          <p className="text-lg font-bold text-gray-900 leading-tight">{section.headline}</p>
        </div>
      )}
      {section.description && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 uppercase font-medium mb-1">Description</div>
          <p className="text-sm text-gray-700 leading-relaxed">{section.description}</p>
        </div>
      )}
      {section.cta && (
        <div>
          <div className="text-xs text-gray-400 uppercase font-medium mb-1">Call to Action</div>
          <span className="inline-block bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">{section.cta}</span>
        </div>
      )}
      {section.items?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-400 uppercase font-medium mb-2">Key Points</div>
          <ul className="space-y-1.5">
            {(section.items as string[]).map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <ArrowRight className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function WebsiteConcept({ data, locked = false }: WebsiteConceptProps) {
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState('');

  const handleGenerate = async () => {
    if (!data?.sections?.length || generating) return;
    setGenerating(true);
    setGenError('');
    setGeneratedUrl(null);
    try {
      const res = await fetch('/api/generate-concept-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections: data.sections,
          colorPalette: data.colorPalette,
          businessName: data.businessName,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.html) {
        const blob = new Blob([result.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        setGeneratedUrl(url);
        window.open(url, '_blank');
      } else {
        setGenError(result.error ?? 'Failed to generate website');
      }
    } catch {
      setGenError('Something went wrong. Please try again.');
    }
    setGenerating(false);
  };

  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Website Concept</h3>
        <p className="text-gray-400 text-sm">Website concept will appear once analysis completes.</p>
      </div>
    );
  }

  const sectionIcons = [Layout, Users, Briefcase, ArrowRight];
  const sectionColors = ['bg-blue-600', 'bg-purple-600', 'bg-orange-500', 'bg-green-600'];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-500 px-6 py-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Globe className="w-5 h-5" /> Website Concept
        </h3>
        <p className="text-violet-100 text-sm mt-1">
          Ready-to-use website copy for {data.businessName ?? 'your business'}
        </p>
      </div>

      <div className="p-6 relative">
        {locked && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock website concept</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {(data.sections ?? []).map((section: any, i: number) => (
            <SectionCard
              key={i}
              section={section}
              icon={sectionIcons[i] ?? Globe}
              color={sectionColors[i] ?? 'bg-gray-600'}
            />
          ))}
        </div>

        {/* Color Palette */}
        {data.colorPalette?.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Suggested Color Palette</h4>
            <div className="flex gap-3">
              {(data.colorPalette as any[]).map((c: any, i: number) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-lg shadow-sm border border-gray-200" style={{ backgroundColor: c.hex ?? '#ccc' }} />
                  <span className="text-xs text-gray-500">{c.name ?? c.hex}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generate Concept Website Button */}
        <div className="mt-8 bg-gradient-to-r from-violet-50 to-fuchsia-50 rounded-xl p-6 border border-violet-100 text-center">
          <Sparkles className="w-8 h-8 text-violet-500 mx-auto mb-3" />
          <h4 className="text-lg font-bold text-gray-900 mb-2">See It Come to Life</h4>
          <p className="text-sm text-gray-600 mb-4">
            Generate a fully designed concept website using the copy and colors above.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating || locked}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white rounded-xl font-semibold hover:from-violet-700 hover:to-fuchsia-600 transition-all disabled:opacity-50 shadow-lg shadow-violet-200"
          >
            {generating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Generating Website...</>
            ) : (
              <><Sparkles className="w-5 h-5" /> Generate Concept Website</>
            )}
          </button>

          {genError && (
            <p className="text-red-500 text-sm mt-3">{genError}</p>
          )}

          {generatedUrl && !generating && (
            <div className="mt-4">
              <a
                href={generatedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-800 transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Open Generated Website Again
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
