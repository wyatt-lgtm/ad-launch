'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle, AlertCircle, Search, Sparkles, FileCheck,
  Lock, Clock, CircleDot, XCircle, MapPin, Edit3,
  Building2, Newspaper, CalendarHeart, Plus, Trash2, Star,
} from 'lucide-react';
import WatermarkCard from '../../../components/watermark-card';
import SeoInsights from '../../../components/seo-insights';
import PostingPlan from '../../../components/posting-plan';
import GoogleAdsCopy from '../../../components/google-ads-copy';
import WebsiteConcept from '../../../components/website-concept';
// BudgetRecommendations removed per user request
import RegistrationModal from '../../../components/registration-modal';
import LiveActivityLog from '../../../components/live-activity-log';
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
  // Timing fields for live activity log
  created_at?: string | null;
  claimed_at?: string | null;
  heartbeat_at?: string | null;
  updated_at?: string | null;
  retry_count?: number;
}

interface Ad {
  id: string;
  imageUrl: string | null;
  watermarkedUrl: string | null;
  caption: string | null;
  headline: string | null;
  copyOnly?: boolean;
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
    research_pipeline: 'Automated research',
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

/** A confirmed/pending location in multi-location mode */
interface SelectedLocation {
  key: string; // unique client key
  locationName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  county: string;
  phone: string;
  placeId: string;
  googleMapsUrl: string;
  source: string;
  isPrimary: boolean;
}

function makeEmptyLocation(source = 'user_added'): SelectedLocation {
  return {
    key: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    locationName: '', address1: '', address2: '', city: '', state: '', postalCode: '',
    county: '', phone: '', placeId: '', googleMapsUrl: '', source, isPrimary: false,
  };
}

function placeToLocation(place: PlaceCandidate): SelectedLocation {
  return {
    key: `gp_${place.placeId}`,
    locationName: place.name,
    address1: place.formattedAddress,
    address2: '',
    city: place.city,
    state: place.state,
    postalCode: place.zip,
    county: '',
    phone: place.phone,
    placeId: place.placeId,
    googleMapsUrl: place.googleMapsUrl,
    source: 'google_places',
    isPrimary: false,
  };
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
  // Manual entry fields (single-location mode)
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');
  const [manualZip, setManualZip] = useState('');
  const [showManual, setShowManual] = useState(false);
  // Multi-location state
  const [multiMode, setMultiMode] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<SelectedLocation[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLoc, setNewLoc] = useState<SelectedLocation>(makeEmptyLocation());
  // businessId for location API
  const [businessId, setBusinessId] = useState<string | null>(null);
  // Service area mode
  const [serviceAreaMode, setServiceAreaMode] = useState<'local' | 'regional' | 'national' | 'multi_location'>('local');

  /** Smart paste: if user pastes a full address like "123 Main St, City, ST 12345", split it */
  const handleAddressPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')?.trim() ?? '';
    if (!pasted) return;
    // Match patterns like: "Street, City, ST 12345" or "Street, City, ST"
    const match = pasted.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);
    if (match) {
      e.preventDefault();
      setManualAddress(match[1].trim());
      setManualCity(match[2].trim());
      setManualState(match[3].trim().toUpperCase());
      if (match[4]) setManualZip(match[4].trim());
    }
  };

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const data = await res.json().catch(() => ({}));

        const aStatus = data?.analysis?.status ?? data?.status;
        // Store businessId for location API
        const bId = data?.analysis?.businessId ?? data?.businessId;
        if (bId) setBusinessId(bId);

        if (aStatus && aStatus !== 'pending_location') {
          onLaunched();
          return;
        }

        // Check for scraped address from website (kept for reference / fallback)
        const scrapedCache = sessionStorage.getItem(`scraped_${analysisId}`);
        if (scrapedCache) {
          const parsed = JSON.parse(scrapedCache);
          if (parsed?.source && parsed.source !== 'none' && (parsed.city || parsed.zip)) {
            setScrapedAddress(parsed);
          }
        }

        // Check for Google Places results (includes cross-validated results)
        const cached = sessionStorage.getItem(`places_${analysisId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setPlaces(parsed);
          if (parsed.length > 0) {
            setSelected(parsed[0]);
            // Pre-fill manual fields from Google Places (canonical address)
            setManualName(parsed[0].name ?? '');
            setManualAddress(parsed[0].formattedAddress ?? '');
            setManualCity(parsed[0].city ?? '');
            setManualState(parsed[0].state ?? '');
            setManualZip(parsed[0].zip ?? '');
          }
        } else if (scrapedCache) {
          // No Google Places results — fall back to scraped address for manual fields
          const parsed = JSON.parse(scrapedCache);
          if (parsed?.source && parsed.source !== 'none' && (parsed.city || parsed.zip)) {
            setManualName(parsed.businessName ?? '');
            setManualAddress(parsed.address ?? '');
            setManualCity(parsed.city ?? '');
            setManualState(parsed.state ?? '');
            setManualZip(parsed.zip ?? '');
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

  // ── Multi-location helpers ─────────────────────────────────────────
  const togglePlaceInMulti = (place: PlaceCandidate) => {
    setSelectedLocations(prev => {
      const exists = prev.find(l => l.placeId === place.placeId);
      if (exists) {
        return prev.filter(l => l.placeId !== place.placeId);
      }
      const loc = placeToLocation(place);
      if (prev.length === 0) loc.isPrimary = true;
      return [...prev, loc];
    });
  };

  const setPrimary = (key: string) => {
    setSelectedLocations(prev => prev.map(l => ({ ...l, isPrimary: l.key === key })));
  };

  const removeLocation = (key: string) => {
    setSelectedLocations(prev => {
      const updated = prev.filter(l => l.key !== key);
      if (updated.length > 0 && !updated.some(l => l.isPrimary)) {
        updated[0].isPrimary = true;
      }
      return updated;
    });
  };

  const addManualLocation = () => {
    if (!newLoc.city || !newLoc.state) return;
    const loc = { ...newLoc, key: `manual_${Date.now()}` };
    if (selectedLocations.length === 0) loc.isPrimary = true;
    setSelectedLocations(prev => [...prev, loc]);
    setNewLoc(makeEmptyLocation());
    setShowAddForm(false);
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setError('');
    try {
      // Build primary location fields (always sent for backward-compat Analysis update)
      let primaryPayload: any;

      if (multiMode && selectedLocations.length > 0) {
        const primary = selectedLocations.find(l => l.isPrimary) || selectedLocations[0];
        primaryPayload = {
          name: primary.locationName,
          address: primary.address1,
          city: primary.city,
          state: primary.state,
          zip: primary.postalCode,
          phone: primary.phone,
          placeId: primary.placeId || undefined,
          googleMapsUrl: primary.googleMapsUrl || undefined,
        };
      } else if (selected) {
        primaryPayload = {
          name: selected.name,
          address: selected.formattedAddress,
          city: selected.city,
          state: selected.state,
          zip: selected.zip,
          phone: selected.phone,
          placeId: selected.placeId,
          googleMapsUrl: selected.googleMapsUrl,
        };
      } else {
        primaryPayload = {
          name: manualName,
          address: manualAddress,
          city: manualCity,
          state: manualState,
          zip: manualZip,
        };
      }

      // Attach full multi-location payload inline so confirm-and-launch
      // persists ALL locations transactionally BEFORE launching the workflow.
      if (multiMode && selectedLocations.length > 0) {
        const primaryIdx = selectedLocations.findIndex(l => l.isPrimary);
        primaryPayload.multiLocation = {
          hasMultipleLocations: true,
          primaryLocationIndex: primaryIdx >= 0 ? primaryIdx : 0,
          locations: selectedLocations.map(l => ({
            locationName: l.locationName,
            address1: l.address1,
            address2: l.address2,
            city: l.city,
            state: l.state,
            postalCode: l.postalCode,
            county: l.county,
            phone: l.phone,
            placeId: l.placeId || undefined,
            googleMapsUrl: l.googleMapsUrl || undefined,
            source: l.source,
          })),
        };
      }

      // Attach service area mode
      primaryPayload.serviceAreaMode = serviceAreaMode;
      primaryPayload.isNationwide = serviceAreaMode === 'national';

      const res = await fetch(`/api/analysis/${analysisId}/confirm-and-launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(primaryPayload),
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

  // Launch button disabled logic
  const launchDisabled = launching || (
    multiMode
      ? selectedLocations.length === 0
      : (!selected && (!manualCity || !manualState))
  );

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
          We&apos;ll use this to find local news and events for your social media posts
        </p>
      </div>

      {/* Multi-location toggle — only show when Google Places returned results */}
      {places.length > 1 && (
        <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={multiMode}
            onChange={() => {
              setMultiMode(prev => !prev);
              // When entering multi-mode, seed selectedLocations from currently selected place
              if (!multiMode && selected) {
                setSelectedLocations([{ ...placeToLocation(selected), isPrimary: true }]);
              }
            }}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 font-medium">I have multiple locations</span>
        </label>
      )}

      {/* ════════ SINGLE-LOCATION MODE (default / legacy behavior) ════════ */}
      {!multiMode && (
        <>
          {/* Scraped Address from Website (only shown when Google Places couldn't cross-validate) */}
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
                    onPaste={handleAddressPaste}
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

          {/* Google Places Results — single-select radio style */}
          {places.length > 0 && !showManual && (
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
                My business isn&apos;t listed — enter manually
              </button>
            </div>
          )}

          {/* No Google Maps listing — missing customers message */}
          {places.length === 0 && !showManual && !scrapedAddress && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-base font-semibold text-amber-800">Your business wasn&apos;t found on Google Maps</h3>
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
                    In the meantime, please enter your address below so we can create your posts.
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

          {/* Manual Entry (single-location) */}
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
                  onPaste={handleAddressPaste}
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
        </>
      )}

      {/* ════════ MULTI-LOCATION MODE ════════ */}
      {multiMode && (
        <>
          {/* Google Places as multi-select checkboxes */}
          {places.length > 0 && (
            <div className="space-y-3 mb-6">
              <p className="text-xs text-gray-500 font-medium">Select all locations that belong to your business:</p>
              {places.map((place) => {
                const isChecked = selectedLocations.some(l => l.placeId === place.placeId);
                return (
                  <button
                    key={place.placeId}
                    onClick={() => togglePlaceInMulti(place)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      isChecked
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
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-1 ${
                        isChecked ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                      }`}>
                        {isChecked && <CheckCircle className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected locations summary cards */}
          {selectedLocations.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                Selected locations ({selectedLocations.length})
              </h4>
              <div className="space-y-2">
                {selectedLocations.map((loc) => (
                  <div
                    key={loc.key}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      loc.isPrimary ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {loc.locationName || loc.address1 || `${loc.city}, ${loc.state}`}
                        </span>
                        {loc.isPrimary && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 rounded">
                            <Star className="w-2.5 h-2.5" /> Primary
                          </span>
                        )}
                      </div>
                      {loc.address1 && loc.locationName && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{loc.address1}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {!loc.isPrimary && (
                        <button
                          onClick={() => setPrimary(loc.key)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
                          title="Set as primary"
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => removeLocation(loc.key)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add another location form */}
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-6 text-sm font-medium text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add a location not listed above
            </button>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-gray-700">Add Location</h4>
                <button
                  onClick={() => { setShowAddForm(false); setNewLoc(makeEmptyLocation()); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Location Name</label>
                <input
                  type="text"
                  value={newLoc.locationName}
                  onChange={(e) => setNewLoc(prev => ({ ...prev, locationName: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                  placeholder="Downtown Branch"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Street Address</label>
                <input
                  type="text"
                  value={newLoc.address1}
                  onChange={(e) => setNewLoc(prev => ({ ...prev, address1: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                  placeholder="123 Main Street"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                  <input
                    type="text"
                    value={newLoc.city}
                    onChange={(e) => setNewLoc(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
                  <input
                    type="text"
                    value={newLoc.state}
                    onChange={(e) => setNewLoc(prev => ({ ...prev, state: e.target.value.toUpperCase().slice(0, 2) }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                    placeholder="ST"
                    maxLength={2}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">ZIP Code</label>
                  <input
                    type="text"
                    value={newLoc.postalCode}
                    onChange={(e) => setNewLoc(prev => ({ ...prev, postalCode: e.target.value.replace(/[^\d-]/g, '').slice(0, 10) }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                    placeholder="12345"
                    maxLength={10}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone (optional)</label>
                <input
                  type="text"
                  value={newLoc.phone}
                  onChange={(e) => setNewLoc(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                  placeholder="(555) 123-4567"
                />
              </div>
              <button
                onClick={addManualLocation}
                disabled={!newLoc.city || !newLoc.state}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Plus className="w-4 h-4" /> Add Location
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Service Area Mode ── */}
      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-semibold text-gray-900 mb-1">Service Area</h4>
        <p className="text-xs text-gray-500 mb-3">How does this business serve its customers?</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'local' as const, label: 'Local / Single Market', desc: 'City or metro area' },
            { value: 'regional' as const, label: 'Regional', desc: 'Multi-city or state' },
            { value: 'national' as const, label: 'Nationwide', desc: 'Serves customers everywhere' },
            { value: 'multi_location' as const, label: 'Multi-Location / Agency', desc: 'Multiple offices or clients' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setServiceAreaMode(opt.value)}
              className={`text-left p-3 rounded-lg border-2 transition-all ${
                serviceAreaMode === opt.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="text-sm font-medium text-gray-900">{opt.label}</div>
              <div className="text-xs text-gray-500">{opt.desc}</div>
            </button>
          ))}
        </div>
        {(serviceAreaMode === 'national' || serviceAreaMode === 'multi_location') && (
          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            Your address will be used as HQ/contact info, not as the content market.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-500 text-sm justify-center">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <button
        onClick={handleLaunch}
        disabled={launchDisabled}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-200"
      >
        {launching ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Sparkles className="w-5 h-5" />
        )}
        {launching
          ? 'Launching Post Creation...'
          : multiMode && selectedLocations.length > 1
            ? `Confirm ${selectedLocations.length} Locations & Create Posts`
            : 'Confirm Location & Create Posts'}
      </button>

      <p className="text-center text-xs text-gray-400 mt-3">
        This helps us find local news, events, and community content for your social posts
      </p>
    </div>
  );
}

/* ── Lane configuration ───────────────────────────────────── */
const LANE_CONFIG: Record<string, { label: string; description: string; icon: React.ElementType; color: string; bgColor: string }> = {
  website:  { label: 'Website / Brand', description: 'Created from your website content', icon: Building2, color: 'text-blue-600', bgColor: 'bg-blue-50' },
  news:     { label: 'Local News', description: 'Tied to local news in your area', icon: Newspaper, color: 'text-amber-600', bgColor: 'bg-amber-50' },
  holiday:  { label: 'Upcoming Holiday', description: 'Tied to upcoming calendar events', icon: CalendarHeart, color: 'text-rose-600', bgColor: 'bg-rose-50' },
  seasonal: { label: 'Upcoming Holiday', description: 'Tied to upcoming calendar events', icon: CalendarHeart, color: 'text-rose-600', bgColor: 'bg-rose-50' },
};

/** Strict pipeline phase ordering — frontend must never move backward */
const PHASE_ORDER = ['connecting', 'pipeline_preparing', 'generating', 'finalizing', 'completed', 'completed_with_warnings', 'failed'] as const;
type PipelinePhase = typeof PHASE_ORDER[number];

function phaseRank(p: PipelinePhase): number {
  const idx = PHASE_ORDER.indexOf(p);
  return idx >= 0 ? idx : 0;
}

export default function AnalysisTracker({ analysisId }: { analysisId: string }) {
  const [phase, setPhase] = useState<'location' | 'tracking'>('location');
  const [status, setStatus] = useState('processing');
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('connecting');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [laneStatuses, setLaneStatuses] = useState<Record<string, any>>({});
  const [laneWorkflows, setLaneWorkflows] = useState<Record<string, string | string[]>>({});
  const [seoData, setSeoData] = useState<any>(null);
  const [postingPlan, setPostingPlan] = useState<any>(null);
  const [googleAdsData, setGoogleAdsData] = useState<any>(null);
  const [websiteConceptData, setWebsiteConceptData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [error, setError] = useState('');
  const [failedStage, setFailedStage] = useState<string | null>(null);
  const [failedLanes, setFailedLanes] = useState<string[]>([]);
  const [showRegister, setShowRegister] = useState(false);
  const [generatingLane, setGeneratingLane] = useState<string | null>(null);
  const [stallCount, setStallCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const pollStartRef = React.useRef<number>(0);
  const consecutiveErrorsRef = React.useRef<number>(0);
  const stallCountRef = React.useRef(stallCount);
  stallCountRef.current = stallCount;
  const highWaterPhaseRef = React.useRef<PipelinePhase>('connecting');
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

      // Update pipeline phase with high-water mark — NEVER go backward
      const serverPhase = (data?.pipelinePhase ?? 'connecting') as PipelinePhase;
      const serverRank = phaseRank(serverPhase);
      const currentRank = phaseRank(highWaterPhaseRef.current);
      // Allow terminal states (completed, completed_with_warnings, failed) to override,
      // but never go from completed/failed back to connecting/generating
      if (serverRank >= currentRank) {
        highWaterPhaseRef.current = serverPhase;
        setPipelinePhase(serverPhase);
      } else {
        // Server sent a lower phase (e.g. processing after completed) — ignore it
        console.warn(`[analysis-tracker] Ignoring backward phase transition: ${serverPhase} < ${highWaterPhaseRef.current}`);
      }

      // Update lane statuses
      if (data?.laneStatuses) setLaneStatuses(data.laneStatuses);

      // Stall detection: increment counter if still in connecting phase with no tasks and no pipelinePhase advance
      if (s === 'processing' && (!data?.tasks || data.tasks.length === 0) && serverPhase === 'connecting') {
        setStallCount(prev => prev + 1);
      } else {
        setStallCount(0);
      }

      // Capture lane workflow mapping
      if (data?.laneWorkflows && Object.keys(data.laneWorkflows).length > 0) {
        setLaneWorkflows(data.laneWorkflows);
      }

      // Update live task list
      if (data?.tasks?.length > 0) {
        setTasks(data.tasks);
      }

      // Accept partial ads during generation (progressive lane results)
      if (data?.ads?.length) setAds(data.ads);

      // Log diagnostics if present
      if (data?.diagnostics) {
        console.warn('[analysis-tracker] Diagnostics:', JSON.stringify(data.diagnostics));
      }

      if (s === 'completed') {
        // CRITICAL: Only accept 'completed' if there are actual ads
        const adsReceived = data?.ads?.length ?? 0;
        if (adsReceived === 0) {
          console.warn('[analysis-tracker] Server said completed but 0 ads — treating as finalizing');
          // Don't set status to completed; keep processing
          setStatus('processing');
          return;
        }

        if (data?.seoData) setSeoData(data.seoData);
        if (data?.postingPlan) setPostingPlan(data.postingPlan);
        if (data?.googleAdsData) setGoogleAdsData(data.googleAdsData);
        if (data?.websiteConceptData) setWebsiteConceptData(data.websiteConceptData);
        if (data?.budgetData) setBudgetData(data.budgetData);
        // Track if some lanes failed (partial success)
        if (data?.failedLanes?.length) setFailedLanes(data.failedLanes);

        // Safety net: if fewer than 3 ads arrived, do 1-2 delayed re-polls
        if (adsReceived < 3) {
          const doDelayedPoll = async (delay: number) => {
            await new Promise(r => setTimeout(r, delay));
            try {
              const retry = await fetch(`/api/mission-status?analysisId=${analysisId}`);
              const retryData = await retry.json().catch(() => ({}));
              if (retryData?.ads?.length) setAds(retryData.ads);
            } catch { /* ignore */ }
          };
          doDelayedPoll(3000);
          doDelayedPoll(8000);
        }
      } else if (s === 'error') {
        setError(data?.errorReason ?? 'Analysis failed. Please try again.');
        if (data?.tasks?.length) {
          const failed = data.tasks.find((t: any) => t.status === 'error' && t.lastError);
          if (failed) {
            setFailedStage(failed.label ?? failed.department ?? null);
          }
        }
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  }, [analysisId]);

  /* ── Group ads by lane (deduplicated: latest per lane wins) ─── */
  const adsByLane = React.useMemo(() => {
    const map: Record<string, Ad[]> = { website: [], news: [], holiday: [] };
    const seen = new Set<string>();
    // Sort so latest ad per lane wins (by id descending as proxy for creation time)
    const sorted = [...ads].sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''));
    for (const ad of sorted) {
      let lane = (ad as any).lane;
      if (lane === 'seasonal') lane = 'holiday';
      const dedupeKey = lane || `fallback-${ad.imageUrl}-${ad.headline}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (lane && map[lane]) {
        map[lane].push(ad);
      } else {
        if (map.website.length === 0) map.website.push(ad);
        else if (map.news.length === 0) map.news.push(ad);
        else if (map.holiday.length === 0) map.holiday.push(ad);
        else map.website.push(ad);
      }
    }
    return map;
  }, [ads]);

  /* ── Generate more posts for a lane ─────────────────────── */
  const handleGenerateMore = useCallback(async (lane: string) => {
    setGeneratingLane(lane);
    try {
      const res = await fetch(`/api/analysis/${analysisId}/generate-more`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        // Re-poll to pick up new ads
        setTimeout(() => pollStatus(), 2000);
      } else {
        console.error('[generate-more] Failed:', data?.error);
      }
    } catch (err: any) {
      console.error('[generate-more] Error:', err);
    } finally {
      setGeneratingLane(null);
    }
  }, [analysisId, pollStatus]);

  const statusRef = React.useRef(status);
  statusRef.current = status;

  // Only start polling when in tracking phase — with exponential backoff and max duration
  useEffect(() => {
    if (phase !== 'tracking') return;
    pollStartRef.current = Date.now();
    consecutiveErrorsRef.current = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const MAX_POLL_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    const scheduleNext = () => {
      if (cancelled) return;
      if (statusRef.current === 'completed' || statusRef.current === 'error') return;

      // Stop after max duration
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed > MAX_POLL_DURATION_MS) {
        console.warn('[analysis-tracker] Max polling duration reached — stopping');
        setStatus('error');
        setError('Analysis is taking longer than expected. Please check back shortly or try again.');
        return;
      }

      // Exponential backoff based on stall count
      // 0-9: 6s, 10-19: 15s, 20+: 30s
      const sc = stallCountRef.current;
      const delay = sc < 10 ? 6000 : sc < 20 ? 15000 : 30000;

      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await pollStatus();
        scheduleNext();
      }, delay);
    };

    // Initial poll
    pollStatus().then(() => { if (!cancelled) scheduleNext(); });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId, phase]);

  // Check initial state — if analysis is already past pending_location, skip to tracking
  useEffect(() => {
    const checkState = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const data = await res.json().catch(() => ({}));
        const aStatus = data?.analysis?.status ?? data?.status;
        if (aStatus && aStatus !== 'pending_location') {
          setPhase('tracking');
        }
      } catch {}
    };
    checkState();
  }, [analysisId]);

  // If user is confirmed and analysis is complete WITH ads, redirect to results
  useEffect(() => {
    if (status === 'completed' && ads.length > 0 && (session?.user as any)?.confirmed) {
      router.push(`/results/${analysisId}`);
    }
  }, [status, session, analysisId, router, ads]);

  // Deduplicate tasks by department across 3 parallel workflows for cleaner display.
  // Enforce sequential appearance: a step can only show "active" if the prior step
  // is at least partially complete, so the tracker never looks out of order.
  const displayTasks = React.useMemo(() => {
    if (tasks.length === 0) return [];
    // Group by department label
    const byDept = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      const key = t.label;
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(t);
    }
    const result: TaskItem[] = [];
    const deptOrder = ['Business Analysis', 'Marketing Strategy', 'Ad Copywriting', 'Visual Direction', 'Image Generation'];
    let prevAllComplete = true; // first step has no prerequisite
    for (const dept of deptOrder) {
      const items = byDept.get(dept);
      if (!items || items.length === 0) continue;
      const hasActive = items.some(i => i.status === 'active');
      const allComplete = items.every(i => i.status === 'complete');
      const hasError = items.some(i => i.status === 'error');
      const completeCount = items.filter(i => i.status === 'complete').length;
      // Show as "active" as soon as the prior step finishes — don't wait for the
      // backend to report the agent has claimed this task. This eliminates the
      // ~12s visual gap between task completion and next task starting.
      const hasWaiting = items.some(i => i.status === 'waiting');
      // Only show 'error' once ALL parallel tasks in the department have
      // settled (no active/waiting remaining). This prevents premature red
      // indicators when 1 of 3 parallel lanes fails but others are still
      // running.
      const effectiveStatus: TaskItem['status'] = allComplete
        ? 'complete'
        : (hasError && !hasActive && !hasWaiting) ? 'error'
        : (hasActive || (prevAllComplete && !allComplete)) ? 'active'
        : 'waiting';
      result.push({
        ...items[0],
        status: effectiveStatus,
        description: items.length > 1
          ? `${items[0].description} (${completeCount}/${items.length} complete)`
          : items[0].description,
      });
      prevAllComplete = allComplete;
    }
    return result;
  }, [tasks]);

  // Progress percentage — derived from pipelinePhase + laneStatuses so
  // it advances even when displayTasks is empty (common early in the run).
  const progress = React.useMemo(() => {
    // Phase-based baseline progress
    const phaseProgress: Record<string, number> = {
      connecting: 5,
      pipeline_preparing: 15,
      generating: 40,
      finalizing: 90,
      completed: 100,
      completed_with_warnings: 100,
      failed: 0,
    };
    const base = phaseProgress[pipelinePhase] ?? 5;

    // During 'generating', refine using lane completion ratios
    if (pipelinePhase === 'generating') {
      const laneKeys = Object.keys(laneStatuses);
      if (laneKeys.length > 0) {
        const done = laneKeys.filter(k => {
          const s = laneStatuses[k];
          return s === 'generated_full' || s === 'generated_copy_only' || s === 'failed' || s === 'skipped';
        }).length;
        // Scale from 40 → 85 based on lane completion
        return Math.round(40 + (done / laneKeys.length) * 45);
      }
      // If we have displayTasks, use those as a secondary signal
      if (displayTasks.length > 0) {
        const complete = displayTasks.filter(t => t.status === 'complete').length;
        return Math.round(40 + (complete / displayTasks.length) * 45);
      }
    }
    return base;
  }, [pipelinePhase, laneStatuses, displayTasks]);

  // ── Derived state & remaining hooks MUST be above all early returns ──
  // (React #310: every render must call the same number of hooks)
  const hasUsableAds = ads.length > 0;
  const isCompleted = (pipelinePhase === 'completed' || pipelinePhase === 'completed_with_warnings') && hasUsableAds;
  const isFinalizing = pipelinePhase === 'finalizing' || (status === 'completed' && !hasUsableAds);
  const isGenerating = !isCompleted && pipelinePhase !== 'failed';

  // Pipeline step indicators
  const stepLabels = React.useMemo((): Array<{ label: string; status: string }> => {
    const p = pipelinePhase;
    const r = phaseRank(p);
    return [
      { label: r >= phaseRank('pipeline_preparing') ? 'Content engine connected' : 'Connecting to content engine...', status: r >= phaseRank('pipeline_preparing') ? 'complete' : 'active' },
      { label: r >= phaseRank('generating') ? 'Business research complete' : 'Researching your business...', status: r >= phaseRank('generating') ? 'complete' : r >= phaseRank('pipeline_preparing') ? 'active' : 'waiting' },
      { label: r >= phaseRank('finalizing') ? 'Posts generated' : 'Writing copy & generating images...', status: r >= phaseRank('finalizing') ? 'complete' : r >= phaseRank('generating') ? 'active' : 'waiting' },
      { label: isCompleted ? 'Posts ready' : 'Finalizing your posts...', status: isCompleted ? 'complete' : r >= phaseRank('finalizing') ? 'active' : 'waiting' },
    ];
  }, [pipelinePhase, isCompleted]);

  // ── Early returns (all hooks are declared above this line) ──────────

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
        {failedStage && (
          <p className="text-sm text-red-500 font-medium mb-2">Failed during: {failedStage}</p>
        )}
        <p className="text-gray-600 mb-6">{error}</p>
        <a href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">
          Try Again
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {isCompleted ? 'Your Results Are Ready!'
            : isFinalizing ? 'Finalizing Your Posts...'
            : 'Creating Your Posts...'}
        </h1>
        {isGenerating && !isFinalizing && (
          <p className="text-blue-600 mt-2 text-base font-medium">
            First-time analysis may take a few minutes while we research your business.
          </p>
        )}
        {isFinalizing && (
          <p className="text-blue-600 mt-2 text-base font-medium">
            Almost there — assembling your generated posts...
          </p>
        )}
        <p className="text-gray-500 mt-2 text-sm">
          {isCompleted
            ? 'Register with your business email to download without watermarks'
            : 'Analyzing your business and crafting 3 unique posts'}
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
          ) : stallCount >= 20 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-4 rounded-lg bg-amber-50 border border-amber-200">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800">Our content engine is currently unavailable or overloaded.</p>
                  <p className="text-amber-600 mt-1">We're retrying automatically. Your request has been queued.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setRetrying(true);
                    setStallCount(0);
                    try { await fetch(`/api/mission-status?analysisId=${analysisId}`); } catch {}
                    setTimeout(() => setRetrying(false), 3000);
                  }}
                  disabled={retrying}
                  className="flex-1 py-2.5 rounded-lg border border-amber-300 bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 transition-colors disabled:opacity-50"
                >
                  {retrying ? 'Checking...' : 'Check Again'}
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="flex-1 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Try Again Later
                </button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                If this persists, contact <a href="mailto:support@launchmarketing.com" className="underline hover:text-gray-600">support@launchmarketing.com</a>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Pipeline step indicators — sequenced by pipelinePhase */}
              {stepLabels.map((step, i) => {
                const stepStatus = String(step.status || 'waiting');
                const stepLabel = String(step.label || '');
                return (
                  <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                    stepStatus === 'complete' ? 'bg-green-50 border-green-200'
                      : stepStatus === 'active' ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    {stepStatus === 'complete' ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : stepStatus === 'active' ? (
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                    )}
                    <span className={`text-sm font-medium ${
                      stepStatus === 'complete' ? 'text-green-700'
                        : stepStatus === 'active' ? 'text-blue-700'
                        : 'text-gray-400'
                    }`}>{stepLabel}</span>
                  </div>
                );
              })}
              {stallCount >= 10 && (
                <p className="text-xs text-gray-400 text-center mt-2">Still connecting to our content engine — this may take a moment...</p>
              )}
            </div>
          )}

          {/* Live activity log */}
          <LiveActivityLog tasks={tasks} />

          {/* Generating posts badge */}
          <div className="mt-4 text-center">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              Generating 3 unique posts
            </span>
          </div>
        </div>
      )}

      {/* Completed: Show all tasks as done */}
      {isCompleted && displayTasks.length > 0 && (
        <div className="max-w-lg mx-auto mb-8">
          <div className="space-y-1">
            {displayTasks.map((task, i) => (
              <TaskRow key={`${task.label}-${i}`} task={{ ...task, status: 'complete' }} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Results: Lane-Based Posts */}
      {isCompleted && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {/* Posts by Content Lane */}
          <div className="mb-12">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold text-gray-900">Your Generated Posts</h2>
              <p className="text-gray-500 text-sm mt-1">3 content lanes to keep your social media fresh and engaging</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {(['website', 'news', 'holiday'] as const).map((lane) => {
                const config = LANE_CONFIG[lane];
                const laneAds = adsByLane[lane] ?? [];
                const Icon = config.icon;
                const isLoadingMore = generatingLane === lane;

                return (
                  <div key={lane} className="space-y-4">
                    {/* Lane Header */}
                    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl ${config.bgColor}`}>
                      <Icon className={`w-5 h-5 ${config.color}`} />
                      <div>
                        <h3 className={`text-sm font-bold ${config.color}`}>{config.label}</h3>
                        <p className="text-xs text-gray-500">
                          {laneAds.length > 0 && laneAds[0].headline
                            ? laneAds[0].headline
                            : config.description}
                        </p>
                      </div>
                    </div>

                    {/* Posts in this lane */}
                    {laneAds.length > 0 ? (
                      laneAds.map((ad, i) => (
                        <WatermarkCard
                          key={ad.id ?? `${lane}-${i}`}
                          caption={ad.caption ?? null}
                          headline={ad.headline ?? null}
                          imageUrl={ad.imageUrl ?? ad.watermarkedUrl ?? null}
                          index={i}
                          angle={config.label}
                          businessName={seoData?.businessName ?? ''}
                          websiteUrl={seoData?.websiteUrl ?? ''}
                          editable={true}
                          copyOnly={ad.copyOnly}
                        />
                      ))
                    ) : failedLanes.includes(lane) ? (
                      <div className="border-2 border-dashed border-amber-200 rounded-xl p-8 text-center bg-amber-50/50">
                        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-amber-700">This post couldn't be generated</p>
                        <p className="text-xs text-amber-500 mt-1">Click "Generate 3 More" below to retry</p>
                      </div>
                    ) : laneStatuses[lane]?.status === 'running' || laneStatuses[lane]?.status === 'queued' ? (
                      <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 text-center bg-blue-50/50">
                        <Loader2 className="w-8 h-8 text-blue-400 mx-auto mb-2 animate-spin" />
                        <p className="text-sm font-medium text-blue-700">Pipeline still processing</p>
                        <p className="text-xs text-blue-500 mt-1">
                          {laneStatuses[lane]?.error || 'Image generation in progress — this may take a few minutes'}
                        </p>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                        <Icon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No post generated yet</p>
                        <p className="text-xs text-gray-300 mt-1">Click "Generate 3 More" below to create one</p>
                      </div>
                    )}

                    {/* Generate More button */}
                    <button
                      onClick={() => handleGenerateMore(lane)}
                      disabled={isLoadingMore || generatingLane !== null}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 ${
                        isLoadingMore
                          ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600'
                      }`}
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating 3 more...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Generate 3 More
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Register CTA — right after posts */}
          <div className="text-center py-8 mb-12">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 max-w-xl mx-auto text-white">
              <h3 className="text-2xl font-bold mb-3">Download Your Posts Without Watermarks</h3>
              <p className="text-blue-100 mb-6">Register with your business email to get all posts in full resolution, ready to publish.</p>
              <button
                onClick={() => setShowRegister(true)}
                className="px-8 py-4 bg-white text-blue-600 rounded-xl font-bold text-lg hover:bg-blue-50 transition-all shadow-lg"
              >
                Register to Download Free
              </button>
              <p className="text-blue-200 text-xs mt-4">No credit card required</p>
            </div>
          </div>

          {/* 90-Day Posting Plan — right after Register CTA */}
          <div className="mb-12">
            <PostingPlan data={postingPlan} locked={false} />
          </div>

          {/* SEO Insights */}
          <div className="mb-12">
            <SeoInsights data={seoData} locked={false} />
          </div>

          {/* Website Concept — collapsed by default */}
          <div className="mb-12">
            <WebsiteConcept data={websiteConceptData} locked={false} analysisId={analysisId} collapsed={true} />
          </div>

          {/* Google Search Ad Copy — collapsed by default */}
          <div className="mb-12">
            <GoogleAdsCopy data={googleAdsData} locked={false} collapsed={true} />
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
