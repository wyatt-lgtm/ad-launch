'use client';

import { useState, useCallback, useRef } from 'react';
import {
  X, Upload, FileText, AlertCircle, CheckCircle, Loader2, Info,
} from 'lucide-react';
import {
  ASSET_CATEGORIES, ASSET_TYPES, CATEGORY_LABELS,
  TEXT_ASSET_TYPES, getValidationRules,
  type AssetCategory,
} from '@/lib/asset-validation';

interface Props {
  businessId: string;
  onClose: () => void;
  onUploaded: () => void;
}

export default function AssetUploadModal({ businessId, onClose, onUploaded }: Props) {
  const [step, setStep] = useState<'select' | 'upload' | 'uploading' | 'done'>('select');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [assetType, setAssetType] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [textContent, setTextContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Optional metadata
  const [usageRights, setUsageRights] = useState('');
  const [sourcePlatform, setSourcePlatform] = useState('');
  const [customerPermission, setCustomerPermission] = useState('');
  const [approvedForAds, setApprovedForAds] = useState(false);
  const [exampleType, setExampleType] = useState('');
  const [pairRole, setPairRole] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTextType = TEXT_ASSET_TYPES.includes(assetType);
  const isTestimonial = ['testimonial_screenshot', 'review_screenshot'].includes(assetType);
  const isCreativeExample = ['existing_ad', 'social_post', 'flyer_brochure', 'website_screenshot', 'negative_example'].includes(assetType);
  const isBeforeAfter = assetType === 'before_after_photo';
  const isCertLicense = ['certification', 'license', 'award'].includes(assetType);

  const rules = !isTextType ? getValidationRules(assetType) : null;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [assetType]);

  const handleFileSelect = (f: File) => {
    setError('');
    setWarning('');
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
  };

  const handleSubmit = async () => {
    setError('');
    setWarning('');

    if (!category || !assetType || !title.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    if (isTextType && !textContent.trim()) {
      setError('Text content is required for this asset type.');
      return;
    }

    if (!isTextType && !file) {
      setError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setStep('uploading');
    setProgress(10);

    try {
      const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);

      const body: any = {
        businessId,
        assetType,
        category,
        title: title.trim(),
        description: description.trim(),
        tags: tagArr,
        usageRights: usageRights || undefined,
        approvedForAds,
      };

      if (isTextType) {
        body.textContent = textContent.trim();
      } else if (file) {
        body.fileName = file.name;
        body.mimeType = file.type;
        body.fileSizeBytes = file.size;
      }

      // Add conditional metadata
      if (isTestimonial) {
        body.sourcePlatform = sourcePlatform || undefined;
        body.customerPermission = customerPermission || undefined;
      }
      if (isCreativeExample) {
        body.exampleType = exampleType || undefined;
      }
      if (isBeforeAfter) {
        body.pairRole = pairRole || undefined;
      }
      if (isCertLicense && expirationDate) {
        body.expirationDate = expirationDate;
      }

      setProgress(25);

      // Step 1: Create asset record + get presigned URL
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed.');
        setStep('upload');
        setUploading(false);
        return;
      }

      if (data.warning) setWarning(data.warning);
      setProgress(40);

      if (data.mode === 'text') {
        // Text asset created, done
        setProgress(100);
        setStep('done');
        setUploading(false);
        return;
      }

      // Step 2: Upload file directly to S3
      if (file && data.uploadUrl) {
        const uploadRes = await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!uploadRes.ok) {
          setError('File upload failed. Please try again.');
          setStep('upload');
          setUploading(false);
          return;
        }
      }

      setProgress(80);

      // Step 3: Confirm upload
      const confirmBody: any = { assetId: data.asset.id };

      // For SVG, read content for sanitization
      if (file && file.type === 'image/svg+xml') {
        const svgText = await file.text();
        confirmBody.svgContent = svgText;
      }

      const confirmRes = await fetch('/api/assets/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmBody),
      });

      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        setError(confirmData.error || 'Upload confirmation failed.');
        setStep('upload');
        setUploading(false);
        return;
      }

      setProgress(100);
      setStep('done');
      setUploading(false);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError('An unexpected error occurred. Please try again.');
      setStep('upload');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Upload Creative Asset</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'done' ? (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Asset Uploaded</h3>
              <p className="text-sm text-gray-500 mb-4">
                {warning && <span className="text-amber-600 block mb-2">{warning}</span>}
                Your asset has been uploaded and is ready for review.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={onUploaded}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={() => { setStep('select'); setFile(null); setTitle(''); setDescription(''); setTextContent(''); setError(''); setWarning(''); }}
                  className="px-5 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
                >
                  Upload Another
                </button>
              </div>
            </div>
          ) : step === 'uploading' ? (
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-600 mb-3">Uploading asset...</p>
              <div className="w-48 mx-auto bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  value={category}
                  onChange={(e) => { setCategory(e.target.value as AssetCategory); setAssetType(''); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select category...</option>
                  {ASSET_CATEGORIES.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              {/* Asset Type */}
              {category && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset Type *</label>
                  <select
                    value={assetType}
                    onChange={(e) => setAssetType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select type...</option>
                    {ASSET_TYPES[category as AssetCategory]?.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* File type/size rules hint */}
              {assetType && rules && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-2">
                  <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-700">
                    <p className="font-medium mb-0.5">File requirements:</p>
                    <p>Types: {rules.allowedMimeTypes.map(m => m.split('/')[1]).join(', ')}</p>
                    <p>Max size: {(rules.maxSizeBytes / (1024*1024)).toFixed(0)} MB</p>
                    {rules.minDimensionPx && <p>Min dimensions: {rules.minDimensionPx}px</p>}
                    {rules.maxDimensionPx && <p>Max dimensions: {rules.maxDimensionPx}px</p>}
                  </div>
                </div>
              )}

              {/* Title */}
              {assetType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Primary Logo, Storefront Summer 2025"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Description */}
              {assetType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Optional description..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}

              {/* Tags */}
              {assetType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Comma-separated, e.g., summer, outdoor, main"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Text content for text assets */}
              {isTextType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Content *</label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={4}
                    placeholder={assetType === 'approved_claim' ? 'Enter approved claim text...' :
                      assetType === 'forbidden_claim' ? 'Enter forbidden claim / no-go claim...' :
                      assetType === 'disclaimer' ? 'Enter required disclaimer text...' :
                      assetType === 'font_notes' ? 'Primary: Montserrat Bold, Secondary: Open Sans...' :
                      'Enter content...'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}

              {/* File drop zone for file assets */}
              {assetType && !isTextType && (
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={rules?.allowedMimeTypes.join(',')}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileSelect(f);
                    }}
                  />
                  {file ? (
                    <div>
                      <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</p>
                      <p className="text-xs text-blue-600 mt-1">Click or drag to replace</p>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600">Drag and drop or <span className="text-blue-600 font-medium">browse</span></p>
                      <p className="text-xs text-gray-400 mt-1">Max {rules ? (rules.maxSizeBytes / (1024*1024)).toFixed(0) : '5'} MB</p>
                    </div>
                  )}
                </div>
              )}

              {/* Conditional metadata fields */}
              {isTestimonial && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Source Platform</label>
                    <select
                      value={sourcePlatform}
                      onChange={(e) => setSourcePlatform(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                    >
                      <option value="">Select...</option>
                      <option value="google">Google</option>
                      <option value="yelp">Yelp</option>
                      <option value="facebook">Facebook</option>
                      <option value="tripadvisor">TripAdvisor</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Customer Permission</label>
                    <select
                      value={customerPermission}
                      onChange={(e) => setCustomerPermission(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                    >
                      <option value="">Select...</option>
                      <option value="granted">Granted</option>
                      <option value="pending">Pending</option>
                      <option value="not_requested">Not Requested</option>
                    </select>
                  </div>
                </div>
              )}

              {isCreativeExample && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Example Type</label>
                  <select
                    value={exampleType}
                    onChange={(e) => setExampleType(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select...</option>
                    <option value="approved_example">Approved Example</option>
                    <option value="past_ad">Past Ad</option>
                    <option value="negative_example">Negative Example</option>
                    <option value="competitor_reference">Competitor Reference</option>
                  </select>
                </div>
              )}

              {isBeforeAfter && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Photo Role</label>
                  <select
                    value={pairRole}
                    onChange={(e) => setPairRole(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select...</option>
                    <option value="before">Before</option>
                    <option value="after">After</option>
                  </select>
                </div>
              )}

              {isCertLicense && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiration Date</label>
                  <input
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                  />
                </div>
              )}

              {/* Usage rights */}
              {assetType && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Usage Rights</label>
                    <select
                      value={usageRights}
                      onChange={(e) => setUsageRights(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                    >
                      <option value="">Select...</option>
                      <option value="owned">Owned</option>
                      <option value="licensed">Licensed</option>
                      <option value="public_domain">Public Domain</option>
                      <option value="customer_permission">Customer Permission</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={approvedForAds}
                        onChange={(e) => setApprovedForAds(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Approved for advertising
                    </label>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Warning */}
              {warning && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {warning}
                </div>
              )}

              {/* Submit */}
              {assetType && (
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={uploading}
                    className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : isTextType ? 'Save' : 'Upload'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
