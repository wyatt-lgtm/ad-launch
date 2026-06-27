'use client';

import { useState } from 'react';
import { X, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import {
  APPROVAL_STATUS_LABELS, TEXT_ASSET_TYPES, INTENDED_USE_OPTIONS,
  type ApprovalStatus,
} from '@/lib/asset-validation';

interface AssetRecord {
  id: string;
  title: string;
  description: string;
  tags: string[];
  assetType: string;
  approvalStatus: string;
  usageRights: string | null;
  priorityScore: number;
  textContent: string | null;
  sourcePlatform: string | null;
  customerPermission: string | null;
  approvedForAds: boolean;
  exampleType: string | null;
  expirationDate: string | null;
  // New fields
  intendedUses?: string[];
  rightsConfirmed?: boolean;
  peopleOrCustomerContent?: boolean;
  customerPermissionConfirmed?: boolean;
  approvedForAI?: boolean;
  publicUseAllowed?: boolean;
  notesForAI?: string | null;
}

interface Props {
  asset: AssetRecord;
  onClose: () => void;
  onUpdated: () => void;
}

export default function AssetEditModal({ asset, onClose, onUpdated }: Props) {
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description);
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [approvalStatus, setApprovalStatus] = useState(asset.approvalStatus);
  const [usageRights, setUsageRights] = useState(asset.usageRights || '');
  const [priorityScore, setPriorityScore] = useState(asset.priorityScore);
  const [textContent, setTextContent] = useState(asset.textContent || '');
  const [approvedForAds, setApprovedForAds] = useState(asset.approvedForAds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // New fields
  const [intendedUses, setIntendedUses] = useState<string[]>(asset.intendedUses || []);
  const [rightsConfirmed, setRightsConfirmed] = useState(asset.rightsConfirmed ?? false);
  const [peopleOrCustomerContent, setPeopleOrCustomerContent] = useState(asset.peopleOrCustomerContent ?? false);
  const [customerPermissionConfirmed, setCustomerPermissionConfirmed] = useState(asset.customerPermissionConfirmed ?? false);
  const [approvedForAI, setApprovedForAI] = useState(asset.approvedForAI ?? true);
  const [publicUseAllowed, setPublicUseAllowed] = useState(asset.publicUseAllowed ?? true);
  const [notesForAI, setNotesForAI] = useState(asset.notesForAI || '');

  const isTextType = TEXT_ASSET_TYPES.includes(asset.assetType);

  const toggleIntendedUse = (use: string) => {
    setIntendedUses(prev =>
      prev.includes(use) ? prev.filter(u => u !== use) : [...prev, use]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const body: any = {
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        approvalStatus,
        usageRights: usageRights || null,
        priorityScore,
        approvedForAds,
        // New fields
        intendedUses,
        rightsConfirmed,
        peopleOrCustomerContent,
        customerPermissionConfirmed: peopleOrCustomerContent ? customerPermissionConfirmed : false,
        approvedForAI,
        publicUseAllowed,
        notesForAI: notesForAI.trim() || null,
      };
      if (isTextType) body.textContent = textContent.trim();

      const res = await fetch(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update.');
        setSaving(false);
        return;
      }

      onUpdated();
    } catch {
      setError('An error occurred.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Edit Asset</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {isTextType && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          )}

          {/* Intended Uses */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Intended Uses</label>
            <div className="flex flex-wrap gap-2">
              {INTENDED_USE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleIntendedUse(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    intendedUses.includes(opt.value)
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={approvalStatus}
                onChange={(e) => setApprovalStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(APPROVAL_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority (0-10)</label>
              <input
                type="number"
                min={0}
                max={10}
                value={priorityScore}
                onChange={(e) => setPriorityScore(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usage Rights</label>
              <select
                value={usageRights}
                onChange={(e) => setUsageRights(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Not specified</option>
                <option value="owned">Owned</option>
                <option value="licensed">Licensed</option>
                <option value="public_domain">Public Domain</option>
                <option value="customer_permission">Customer Permission</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvedForAds}
                  onChange={(e) => setApprovedForAds(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Approved for ads
              </label>
            </div>
          </div>

          {/* Rights & AI Permissions */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Rights &amp; AI Permissions</span>
            </div>

            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>Rights confirmed for marketing use</span>
            </label>

            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={peopleOrCustomerContent}
                onChange={(e) => {
                  setPeopleOrCustomerContent(e.target.checked);
                  if (!e.target.checked) setCustomerPermissionConfirmed(false);
                }}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>Contains recognizable people or customer content</span>
            </label>

            {peopleOrCustomerContent && (
              <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer ml-5">
                <input
                  type="checkbox"
                  checked={customerPermissionConfirmed}
                  onChange={(e) => setCustomerPermissionConfirmed(e.target.checked)}
                  className="rounded border-gray-300 mt-0.5"
                />
                <span>Permission granted from identifiable individuals</span>
              </label>
            )}

            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={approvedForAI}
                onChange={(e) => setApprovedForAI(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>Approved for AI-generated content</span>
            </label>

            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={publicUseAllowed}
                onChange={(e) => setPublicUseAllowed(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>Approved for public-facing use</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes for AI</label>
              <input
                type="text"
                value={notesForAI}
                onChange={(e) => setNotesForAI(e.target.value)}
                placeholder="e.g., Use this logo only on dark backgrounds"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
