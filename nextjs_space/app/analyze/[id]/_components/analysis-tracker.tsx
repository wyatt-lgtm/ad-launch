'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle, AlertCircle, Search, Sparkles, FileCheck,
  Lock, Clock, CircleDot, XCircle, MapPin, Edit3,
} from 'lucide-react';
import WatermarkCard from '../../../components/watermark-card';
import SeoInsights from '../../../components/seo-insights';
import PostingPlan from '../../../components/posting-plan';
import GoogleAdsCopy from '../../../components/google-ads-copy';
import WebsiteConcept from '../../../components/website-concept';
import BudgetRecommendations from '../../../components/budget-recommendations';
import RegistrationModal from '../../../components/registration-modal';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface TaskItem {
  id: number;
  workflowId: string;
  department: string;
  label: string;
  description: string;
  status: 'waiting' | 'active' | 'complete' | 'error';
  rawStatus: string;
}

interface Ad {
  id: string;
  imageUrl: string | null;
  watermarkedUrl: string | null;
  caption: string | null;
  headline: string | null;
}

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'active':
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    case 'error':
      return <XCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Clock className="w-5 h-5 text-gray-300" />;
  }
}

function TaskRow({ task, index }: { task: TaskItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
        task.status === 'active'
          ? 'bg-blue-50 border border-blue-200'
          : task.status === 'complete'
          ? 'bg-green-50/50 border border-green-100'
          : task.status === 'error'
          ? 'bg-red-50 border border-red-100'
          : 'bg-gray-50 border border-gray-100'
      }`}
    >
      <TaskStatusIcon status={task.status} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${
          task.status === 'active' ? 'text-blue-700'
          : task.status === 'complete' ? 'text-green-700'
          : task.status === 'error' ? 'text-red-600'
          : 'text-gray-400'
        }`}>
          {task.label}
        </div>
        {task.status === 'active' && task.description && (
          <div className="text-xs text-blue-500 mt-0.5">{task.description}</div>
        )}
      </div>
      {task.status === 'active' && (
        <span className="text-xs text-blue-500 font-medium animate-pulse">Working...</span>
      )}
    </motion.div>
  );
}

/* ── Location Confirm Card ──────────────────────────────────── */
function LocationConfirmCard({
  analysisId,
  location,
  onConfirmed,
}: {
  analysisId: string;
  location: { address: string; city: string; state: string; zip: string; phone: string; source: string; confidence: number; confirmed: boolean };
  onConfirmed: (loc: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState(location.city);
  const [state, setState] = useState(location.state);
  const [zip, setZip] = useState(location.zip);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(location.confirmed);

  useEffect(() => {
    setCity(location.city);
    setState(location.state);
    setZip(location.zip);
    setConfirmed(location.confirmed);
  }, [location]);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/analysis/${analysisId}/confirm-location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, state, zip }),
      });
      const data = await res.json();
      if (data?.success) {
        setConfirmed(true);
        setEditing(false);
        onConfirmed(data.location);

        // Auto-trigger Clark Kent social post scout after location confirmed
        try {
          await fetch('/api/rss/clark-kent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisId }),
          });
          console.log('[clark-kent] Auto-scout triggered after location confirmation');
        } catch (scoutErr) {
          console.error('[clark-kent] Auto-scout error:', scoutErr);
        }
      }
    } catch (err) {
      console.error('Confirm location error:', err);
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel: Record<string, string> = {
    schema_org: 'Schema.org structured data',
    address_tag: 'HTML address tag',
    footer_parse: 'Website footer',
    regex_fallback: 'Page content scan',
    research_pipeline: 'AI research',
    user_input: 'Your input',
    none: 'Not detected',
  };

  if (confirmed && !editing) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-green-800">
            Location confirmed: {city}{state ? `, ${state}` : ''} {zip}
          </span>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-green-600 hover:text-green-800 underline"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm"
    >
      <div className="flex items-start gap-3 mb-3">
        <MapPin className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Business Location</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            {location.source !== 'none'
              ? `Auto-detected from ${sourceLabel[location.source] ?? location.source}. Please confirm or correct.`
              : 'We couldn\'t detect your location automatically. Please enter it below.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
          <input
            type="text"
            value={city}
            onChange={(e) => { setCity(e.target.value); setEditing(true); }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
            placeholder="City"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
          <input
            type="text"
            value={state}
            onChange={(e) => { setState(e.target.value.toUpperCase().slice(0, 2)); setEditing(true); }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
            placeholder="ST"
            maxLength={2}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ZIP Code</label>
          <input
            type="text"
            value={zip}
            onChange={(e) => { setZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10)); setEditing(true); }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
            placeholder="12345"
            maxLength={10}
          />
        </div>
      </div>

      <button
        onClick={handleConfirm}
        disabled={saving || (!city && !state && !zip)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle className="w-4 h-4" />
        )}
        {saving ? 'Saving...' : 'Confirm Location'}
      </button>
    </motion.div>
  );
}

/* ── Google Places Location Confirmation (Step 2) ──────────── */
interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  googleMapsUrl: string;
  rating: number | null;
  userRatingCount: number | null;
}

function LocationStep({
  analysisId,
  onLaunched,
}: {
  analysisId: string;
  onLaunched: () => void;
}) {
  const [places, setPlaces] = useState<PlaceCandidate[]>([]);
  const [selected, setSelected] = useState<PlaceCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  // Scraped address from website
  const [scrapedAddress, setScrapedAddress] = useState<{
    businessName: string; address: string; city: string; state: string; zip: string; phone: string;
    source: string; confidence: number;
  } | null>(null);
  // Manual entry fields
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');
  const [manualZip, setManualZip] = useState('');
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const data = await res.json().catch(() => ({}));

        if (data?.status && data.status !== 'pending_location') {
          onLaunched();
          return;
        }

        // Check for scraped address from website (highest priority)
        const scrapedCache = sessionStorage.getItem(`scraped_${analysisId}`);
        if (scrapedCache) {
          const parsed = JSON.parse(scrapedCache);
          if (parsed?.source && parsed.source !== 'none' && (parsed.city || parsed.zip)) {
            setScrapedAddress(parsed);
            // Pre-fill manual fields from scraped data
            setManualName(parsed.businessName ?? '');
            setManualAddress(parsed.address ?? '');
            setManualCity(parsed.city ?? '');
            setManualState(parsed.state ?? '');
            setManualZip(parsed.zip ?? '');
            setLoading(false);
            return;
          }
        }

        // Check for Google Places results
        const cached = sessionStorage.getItem(`places_${analysisId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setPlaces(parsed);
          if (parsed.length > 0) setSelected(parsed[0]);
          if (parsed[0]) {
            setManualName(parsed[0].name);
            setManualCity(parsed[0].city);
            setManualState(parsed[0].state);
            setManualZip(parsed[0].zip);
          }
        } else if (data?.businessName) {
          // Pre-fill from analysis record (could be scraped or Google Places)
          setManualName(data.businessName ?? '');
          setManualAddress(data.businessAddr ?? '');
          setManualCity(data.businessCity ?? '');
          setManualState(data.businessState ?? '');
          setManualZip(data.businessZip ?? '');
          // If the record has address data from scraping, show as scraped
          if (data.geoSource && data.geoSource !== 'google_places' && data.geoSource !== 'none' && (data.businessCity || data.businessZip)) {
            setScrapedAddress({
              businessName: data.businessName ?? '',
              address: data.businessAddr ?? '',
              city: data.businessCity ?? '',
              state: data.businessState ?? '',
              zip: data.businessZip ?? '',
              phone: data.businessPhone ?? '',
              source: data.geoSource,
              confidence: 0.7,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch analysis:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  const handleLaunch = async () => {
    setLaunching(true);
    setError('');
    try {
      const payload = selected
        ? {
            name: selected.name,
            address: selected.formattedAddress,
            city: selected.city,
            state: selected.state,
            zip: selected.zip,
            phone: selected.phone,
            placeId: selected.placeId,
            googleMapsUrl: selected.googleMapsUrl,
          }
        : {
            name: manualName,
            address: manualAddress,
            city: manualCity,
            state: manualState,
            zip: manualZip,
          };

      const res = await fetch(`/api/analysis/${analysisId}/confirm-and-launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? 'Failed to launch. Please try again.');
        setLaunching(false);
        return;
      }

      onLaunched();
    } catch (err) {
      console.error('Launch error:', err);
      setError('Something went wrong. Please try again.');
      setLaunching(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto px-4 py-20 text-center">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-500">Scanning your website for business details...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-7 h-7 text-blue-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Confirm Your Business Location</h1>
        <p className="text-gray-500 mt-2 text-sm">
          We'll use this to find local news and events for your social media posts
        </p>
      </div>

      {/* Scraped Address from Website (highest priority) */}
      {scrapedAddress && !showManual && places.length === 0 && (
        <div className="bg-white rounded-xl border-2 border-green-200 p-6 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-green-800">Address found on your website</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Detected from {
                  scrapedAddress.source === 'schema_org' ? 'structured data (Schema.org)' :
                  scrapedAddress.source === 'address_tag' ? 'HTML address tag' :
                  scrapedAddress.source === 'footer_parse' ? 'website footer' :
                  'page content'
                }. Please confirm or edit below.
              </p>
            </div>
          </div>
          {scrapedAddress.businessName && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Business Name</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
              />
            </div>
          )}
          {scrapedAddress.address && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Street Address</label>
              <input
                type="text"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
              <input
                type="text"
                value={manualCity}
                onChange={(e) => setManualCity(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
              <input
                type="text"
                value={manualState}
                onChange={(e) => setManualState(e.target.value.toUpperCase().slice(0, 2))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                maxLength={2}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">ZIP Code</label>
              <input
                type="text"
                value={manualZip}
                onChange={(e) => setManualZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                maxLength={10}
              />
            </div>
          </div>
          {scrapedAddress.phone && (
            <div className="text-xs text-gray-400 mt-1">📞 {scrapedAddress.phone}</div>
          )}
        </div>
      )}

      {/* Google Places Results */}
      {places.length > 0 && !showManual && !scrapedAddress && (
        <div className="space-y-3 mb-6">
          {places.map((place) => (
            <button
              key={place.placeId}
              onClick={() => setSelected(place)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                selected?.placeId === place.placeId
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{place.name}</div>
                  <div className="text-sm text-gray-500 mt-1">{place.formattedAddress}</div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    {place.phone && <span>📞 {place.phone}</span>}
                    {place.rating && (
                      <span>⭐ {place.rating} ({place.userRatingCount ?? 0} reviews)</span>
                    )}
                    {place.googleMapsUrl && (
                      <a
                        href={place.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View on Maps →
                      </a>
                    )}
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1 ${
                  selected?.placeId === place.placeId ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                }`}>
                  {selected?.placeId === place.placeId && (
                    <CheckCircle className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
            </button>
          ))}

          <button
            onClick={() => { setShowManual(true); setSelected(null); }}
            className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium py-2"
          >
            My business isn't listed — enter manually
          </button>
        </div>
      )}

      {/* No Google Maps listing — missing customers message (only when no scraped address either) */}
      {places.length === 0 && !showManual && !scrapedAddress && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-amber-800">Your business wasn't found on Google Maps</h3>
              <p className="text-sm text-amber-700 mt-1">
                You may be missing customers who search for businesses like yours on Google Maps.{' '}
                <a
                  href="https://business.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline font-medium"
                >
                  Add your business to Google Maps for free →
                </a>
              </p>
              <p className="text-sm text-amber-600 mt-2">
                In the meantime, please enter your address below so we can create your ads.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowManual(true)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-all"
          >
            <Edit3 className="w-4 h-4" />
            Enter Address Manually
          </button>
        </div>
      )}

      {/* Manual Entry (user chose manual or clicked enter manually) */}
      {showManual && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 space-y-4">
          {places.length > 0 && (
            <button
              onClick={() => { setShowManual(false); if (places[0]) setSelected(places[0]); }}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-2"
            >
              ← Back to Google results
            </button>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Business Name</label>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
              placeholder="Your Business Name"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Street Address</label>
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
              placeholder="123 Main Street"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
              <input
                type="text"
                value={manualCity}
                onChange={(e) => setManualCity(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                placeholder="City"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
              <input
                type="text"
                value={manualState}
                onChange={(e) => setManualState(e.target.value.toUpperCase().slice(0, 2))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                placeholder="ST"
                maxLength={2}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">ZIP Code</label>
              <input
                type="text"
                value={manualZip}
                onChange={(e) => setManualZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                placeholder="12345"
                maxLength={10}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-500 text-sm justify-center">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <button
        onClick={handleLaunch}
        disabled={launching || (!selected && (!manualCity || !manualState))}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-200"
      >
        {launching ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Sparkles className="w-5 h-5" />
        )}
        {launching ? 'Launching Ad Creation...' : 'Confirm Location & Create Ads'}
      </button>

      <p className="text-center text-xs text-gray-400 mt-3">
        This helps us find local news, events, and community content for your social posts
      </p>
    </div>
  );
}

export default function AnalysisTracker({ analysisId }: { analysisId: string }) {
  const [phase, setPhase] = useState<'location' | 'tracking'>('location');
  const [status, setStatus] = useState('processing');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [seoData, setSeoData] = useState<any>(null);
  const [postingPlan, setPostingPlan] = useState<any>(null);
  const [googleAdsData, setGoogleAdsData] = useState<any>(null);
  const [websiteConceptData, setWebsiteConceptData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const { data: session } = useSession() || {};
  const router = useRouter();

  const pollStatus = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await fetch(`/api/mission-status?analysisId=${analysisId}`);
      const data = await res.json().catch(() => ({}));
      const s = data?.status ?? 'processing';

      // If still pending_location, stay in location phase
      if (s === 'pending_location') return;

      setStatus(s);

      // Update live task list
      if (data?.tasks?.length > 0) {
        setTasks(data.tasks);
      }

      if (s === 'completed') {
        if (data?.ads?.length) setAds(data.ads);
        if (data?.seoData) setSeoData(data.seoData);
        if (data?.postingPlan) setPostingPlan(data.postingPlan);
        if (data?.googleAdsData) setGoogleAdsData(data.googleAdsData);
        if (data?.websiteConceptData) setWebsiteConceptData(data.websiteConceptData);
        if (data?.budgetData) setBudgetData(data.budgetData);
      } else if (s === 'error') {
        setError(data?.errorReason ?? 'Analysis failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  }, [analysisId]);

  const statusRef = React.useRef(status);
  statusRef.current = status;

  // Only start polling when in tracking phase
  useEffect(() => {
    if (phase !== 'tracking') return;
    pollStatus();
    const interval = setInterval(() => {
      if (statusRef.current !== 'completed' && statusRef.current !== 'error') {
        pollStatus();
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId, phase]);

  // Check initial state — if analysis is already past pending_location, skip to tracking
  useEffect(() => {
    const checkState = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const data = await res.json().catch(() => ({}));
        if (data?.status && data.status !== 'pending_location') {
          setPhase('tracking');
        }
      } catch {}
    };
    checkState();
  }, [analysisId]);

  // If user is confirmed and analysis is complete, redirect to results
  useEffect(() => {
    if (status === 'completed' && (session?.user as any)?.confirmed) {
      router.push(`/results/${analysisId}`);
    }
  }, [status, session, analysisId, router]);

  // Deduplicate tasks by department per workflow for cleaner display
  const displayTasks = React.useMemo(() => {
    if (tasks.length === 0) return [];
    // Group by department, show highest-priority status
    const byDept = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      const key = t.label;
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(t);
    }
    // For each department, show aggregated status
    const result: TaskItem[] = [];
    const deptOrder = ['Business Analysis', 'Marketing Strategy', 'Ad Copywriting', 'Visual Direction', 'Image Generation'];
    for (const dept of deptOrder) {
      const items = byDept.get(dept);
      if (!items || items.length === 0) continue;
      const hasActive = items.some(i => i.status === 'active');
      const allComplete = items.every(i => i.status === 'complete');
      const hasError = items.some(i => i.status === 'error');
      const completeCount = items.filter(i => i.status === 'complete').length;
      result.push({
        ...items[0],
        status: hasActive ? 'active' : allComplete ? 'complete' : hasError ? 'error' : 'waiting',
        description: items.length > 1
          ? `${items[0].description} (${completeCount}/${items.length} complete)`
          : items[0].description,
      });
    }
    return result;
  }, [tasks]);

  // Progress percentage
  const progress = React.useMemo(() => {
    if (displayTasks.length === 0) return 0;
    const complete = displayTasks.filter(t => t.status === 'complete').length;
    return Math.round((complete / displayTasks.length) * 100);
  }, [displayTasks]);

  // Phase 1: Location confirmation
  if (phase === 'location') {
    return <LocationStep analysisId={analysisId} onLaunched={() => setPhase('tracking')} />;
  }

  if (error) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Analysis Failed</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        <a href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">
          Try Again
        </a>
      </div>
    );
  }

  const isGenerating = status !== 'completed';

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {isGenerating ? 'Creating Your Posts...' : 'Your Results Are Ready!'}
        </h1>
        <p className="text-gray-500 mt-2 text-sm">
          {isGenerating
            ? 'Our AI agents are analyzing your business and crafting 9 unique posts'
            : 'Register with your business email to download without watermarks'}
        </p>
      </div>

      {/* Live Task Tracker */}
      {isGenerating && (
        <div className="max-w-lg mx-auto mb-12">
          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Progress</span>
              <span className="text-sm font-bold text-blue-600">{progress}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Task list */}
          {displayTasks.length > 0 ? (
            <div className="space-y-2">
              {displayTasks.map((task, i) => (
                <TaskRow key={`${task.label}-${i}`} task={task} index={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Placeholder skeleton while tasks load */}
              {['Connecting to AI agents...', 'Preparing analysis pipeline...'].map((text, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  <span className="text-sm font-medium text-blue-700">{text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Generating posts badge */}
          <div className="mt-6 text-center">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              Generating 9 unique posts
            </span>
          </div>
        </div>
      )}

      {/* Completed: Show all tasks as done */}
      {!isGenerating && displayTasks.length > 0 && (
        <div className="max-w-lg mx-auto mb-8">
          <div className="space-y-1">
            {displayTasks.map((task, i) => (
              <TaskRow key={`${task.label}-${i}`} task={{ ...task, status: 'complete' }} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Results: Ads */}
      {!isGenerating && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {/* Ads Section */}
          <div className="mb-12">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Your 3 Generated Ads</h2>
              <p className="text-gray-500 text-sm mt-1">Each targets a different marketing angle for maximum impact</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {(ads.length > 0 ? ads : [null, null, null]).map((ad: any, i: number) => (
                <WatermarkCard
                  key={ad?.id ?? i}
                  caption={ad?.caption ?? null}
                  headline={ad?.headline ?? null}
                  imageUrl={ad?.imageUrl ?? ad?.watermarkedUrl ?? null}
                  index={i}
                  angle={i === 0 ? 'Awareness' : i === 1 ? 'Conversion' : 'Trust'}
                  businessName={seoData?.businessName ?? ''}
                  websiteUrl={seoData?.websiteUrl ?? ''}
                  editable={ads.length > 0}
                />
              ))}
            </div>
          </div>

          {/* Google Search Ad Copy */}
          <div className="mb-12">
            <GoogleAdsCopy data={googleAdsData} locked={false} />
          </div>

          {/* SEO Insights */}
          <div className="mb-12">
            <SeoInsights data={seoData} locked={false} />
          </div>

          {/* Website Concept */}
          <div className="mb-12">
            <WebsiteConcept data={websiteConceptData} locked={false} />
          </div>

          {/* 90-Day Posting Plan */}
          <div className="mb-12">
            <PostingPlan data={postingPlan} locked={false} />
          </div>

          {/* Budget Recommendations */}
          <div className="mb-12">
            <BudgetRecommendations data={budgetData} locked={false} />
          </div>

          {/* Register CTA */}
          <div className="text-center py-8">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 max-w-xl mx-auto text-white">
              <h3 className="text-2xl font-bold mb-3">Download Your Ads Without Watermarks</h3>
              <p className="text-blue-100 mb-6">Register with your business email to get all 3 ads in full resolution, ready to post.</p>
              <button
                onClick={() => setShowRegister(true)}
                className="px-8 py-4 bg-white text-blue-600 rounded-xl font-bold text-lg hover:bg-blue-50 transition-all shadow-lg"
              >
                Register to Download Free
              </button>
              <p className="text-blue-200 text-xs mt-4">Business email required · No credit card needed</p>
            </div>
          </div>
        </motion.div>
      )}

      <RegistrationModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        analysisId={analysisId}
      />
    </div>
  );
}
