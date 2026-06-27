/**
 * Asset validation rules for Creative Asset Library.
 * Enforces file type, size, and dimension limits per asset type/category.
 */

export const ASSET_CATEGORIES = [
  'brand',
  'business_profile',
  'products_services',
  'people_trust',
  'location_service_area',
  'proof_social_proof',
  'video_clips',
  'audio_files',
  'compliance',
  'creative_examples',
] as const;

export type AssetCategory = typeof ASSET_CATEGORIES[number];

export const ASSET_TYPES: Record<AssetCategory, { value: string; label: string }[]> = {
  brand: [
    { value: 'logo_primary', label: 'Primary / Horizontal Logo' },
    { value: 'logo_vertical', label: 'Vertical / Stacked Logo' },
    { value: 'logo_icon', label: 'Icon / Mark Only' },
    { value: 'logo_white', label: 'White / Reverse Logo' },
    { value: 'logo_black', label: 'Black / Single-Color Logo' },
    { value: 'logo_transparent', label: 'Transparent Background Logo' },
    { value: 'logo_avatar', label: 'Square Avatar / Social Profile Logo' },
    { value: 'color_palette', label: 'Brand Color Palette' },
    { value: 'font_notes', label: 'Font / Typography Notes' },
    { value: 'brand_guidelines', label: 'Brand Guidelines (PDF/Doc)' },
  ],
  business_profile: [
    { value: 'owner_bio_doc', label: 'Owner Bio Document' },
    { value: 'founder_story_doc', label: 'Founder Story' },
    { value: 'company_history_doc', label: 'Company History' },
    { value: 'mission_statement_doc', label: 'Mission Statement' },
    { value: 'service_area_doc', label: 'Service Area Description' },
    { value: 'customer_profile_doc', label: 'Customer Profile / Types Served' },
    { value: 'differentiators_doc', label: 'Differentiators / Why Choose Us' },
    { value: 'faq_doc', label: 'Common Customer Questions' },
    { value: 'objections_doc', label: 'Common Objections & Responses' },
    { value: 'brand_voice_doc', label: 'Brand Voice Guide' },
    { value: 'words_avoid_doc', label: 'Words / Claims to Avoid' },
  ],
  products_services: [
    { value: 'product_photo', label: 'Product Photo' },
    { value: 'service_photo', label: 'Service Photo' },
    { value: 'menu_list', label: 'Menu / Service List' },
    { value: 'price_sheet', label: 'Price Sheet' },
    { value: 'offer_sheet', label: 'Offer Sheet' },
    { value: 'process_steps_photo', label: 'Process Steps Photo' },
    { value: 'equipment_photo', label: 'Equipment Photo' },
  ],
  people_trust: [
    { value: 'owner_photo', label: 'Owner / Founder Photo' },
    { value: 'staff_photo', label: 'Staff / Team Photo' },
    { value: 'team_group_photo', label: 'Team Group Photo' },
    { value: 'candid_work_photo', label: 'Candid Working Photo' },
    { value: 'certification', label: 'Certification / Badge' },
    { value: 'license', label: 'License' },
    { value: 'award', label: 'Award' },
    { value: 'press_mention', label: 'Press Mention' },
  ],
  location_service_area: [
    { value: 'storefront_photo', label: 'Storefront / Exterior Photo' },
    { value: 'facility_photo', label: 'Interior / Facility Photo' },
    { value: 'fleet_photo', label: 'Fleet / Vehicle Photo' },
    { value: 'service_area_map', label: 'Service Area Map' },
    { value: 'landmark_photo', label: 'Local Landmark Photo' },
  ],
  proof_social_proof: [
    { value: 'before_after_photo', label: 'Before / After Photo' },
    { value: 'testimonial_screenshot', label: 'Customer Testimonial Screenshot' },
    { value: 'review_screenshot', label: 'Review Screenshot' },
    { value: 'testimonial_text', label: 'Written Testimonial' },
    { value: 'case_study', label: 'Case Study PDF' },
  ],
  video_clips: [
    { value: 'owner_intro_video', label: 'Owner / Founder Intro' },
    { value: 'testimonial_video', label: 'Customer Testimonial Video' },
    { value: 'service_explainer_video', label: 'Service Explainer' },
    { value: 'behind_scenes_video', label: 'Behind-the-Scenes' },
    { value: 'product_demo_video', label: 'Product / Service Demo' },
    { value: 'location_walkthrough_video', label: 'Location Walkthrough' },
    { value: 'before_after_video', label: 'Before / After Transformation' },
    { value: 'faq_answer_video', label: 'FAQ Answer Clip' },
    { value: 'general_video', label: 'Other Video Clip' },
  ],
  audio_files: [
    { value: 'owner_interview_audio', label: 'Owner Interview Audio' },
    { value: 'testimonial_audio', label: 'Customer Testimonial Audio' },
    { value: 'voiceover', label: 'Voiceover' },
    { value: 'jingle', label: 'Jingle / Brand Music' },
    { value: 'phone_greeting', label: 'Phone Greeting' },
    { value: 'podcast_clip', label: 'Podcast Clip' },
    { value: 'general_audio', label: 'Other Audio' },
  ],
  compliance: [
    { value: 'approved_claim', label: 'Approved Claim' },
    { value: 'forbidden_claim', label: 'Forbidden / No-Go Claim' },
    { value: 'disclaimer', label: 'Required Disclaimer' },
    { value: 'usage_rights_doc', label: 'Usage Rights Documentation' },
    { value: 'regulatory_doc', label: 'Regulatory / Licensing Notes' },
  ],
  creative_examples: [
    { value: 'existing_ad', label: 'Existing Ad' },
    { value: 'social_post', label: 'Existing Social Post' },
    { value: 'flyer_brochure', label: 'Flyer / Brochure' },
    { value: 'website_screenshot', label: 'Website Screenshot' },
    { value: 'negative_example', label: 'Negative Example ("Do Not Make Ads Like This")' },
  ],
};

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  brand: 'Logo Pack & Brand',
  business_profile: 'Business Profile & Owner Bio',
  products_services: 'Product & Service Photos',
  people_trust: 'Owner & Team Photos',
  location_service_area: 'Location & Service Area',
  proof_social_proof: 'Testimonials & Reviews',
  video_clips: 'Video Clips',
  audio_files: 'Audio Files',
  compliance: 'Legal & Compliance',
  creative_examples: 'Creative Examples',
};

export const CATEGORY_DESCRIPTIONS: Record<AssetCategory, string> = {
  brand: 'Logos, brand colors, fonts, and brand guidelines',
  business_profile: 'Owner bio, founder story, mission, customer FAQs, and brand voice',
  products_services: 'Product photos, service images, menus, and price sheets',
  people_trust: 'Owner headshots, team photos, certifications, awards',
  location_service_area: 'Storefront, interior, vehicles, service area maps',
  proof_social_proof: 'Before/after, testimonials, reviews, case studies',
  video_clips: 'Short clips for reels, explainers, testimonials, and walkthroughs',
  audio_files: 'Voiceovers, interviews, jingles, phone greetings',
  compliance: 'Disclaimers, regulated claims, prohibited language',
  creative_examples: 'Past ads, social posts, and reference examples',
};

export const CATEGORY_WHY_IT_MATTERS: Record<AssetCategory, string> = {
  brand: 'Ensures all generated content uses your actual branding — consistent logos, colors, and fonts across websites, social posts, videos, and ads.',
  business_profile: 'Helps the AI write more accurate websites, posts, videos, and ads by understanding your story, services, values, and messaging.',
  products_services: 'Real product and service photos make generated content look authentic instead of generic stock imagery.',
  people_trust: 'Owner and team photos build trust and personal connection in websites, social content, and founder story videos.',
  location_service_area: 'Storefront and location photos help create locally relevant content and improve local SEO visibility.',
  proof_social_proof: 'Customer testimonials and before/after photos provide powerful social proof for ads, websites, and social posts.',
  video_clips: 'Short video clips can be repurposed into reels, explainer videos, and founder story content across platforms.',
  audio_files: 'Voice clips and audio can be used for voiceovers, podcast content, and branded audio in video production.',
  compliance: 'Ensures generated content respects legal boundaries, required disclaimers, and prohibited claims.',
  creative_examples: 'Shows the AI what you like and don\'t like so generated content matches your preferred style.',
};

export const CATEGORY_RECOMMENDED_FORMATS: Record<AssetCategory, string> = {
  brand: 'PNG (transparent background preferred), SVG, PDF',
  business_profile: 'TXT, DOCX, PDF, Markdown',
  products_services: 'JPG/JPEG for photos, PNG accepted',
  people_trust: 'JPG/JPEG for photos, PNG, PDF for certificates',
  location_service_area: 'JPG/JPEG, PNG, SVG for maps',
  proof_social_proof: 'JPG/PNG for screenshots, TXT/PDF for written testimonials, MP4 for video',
  video_clips: 'MP4 preferred, MOV accepted',
  audio_files: 'WAV preferred, MP3, M4A accepted',
  compliance: 'TXT, DOCX, PDF',
  creative_examples: 'JPG/PNG for images, PDF for documents',
};

export const CATEGORY_MIN_QUALITY: Record<AssetCategory, string> = {
  brand: 'Horizontal logo: 1200px wide min. Square logo: 1000×1000px min. Transparent PNG preferred.',
  business_profile: '500+ words recommended, ideal 1,000–3,000 words',
  products_services: '1600px wide min for standard photos, 2400px for hero/banner',
  people_trust: 'Headshots: 1200×1200px min. Team photos: 2000px wide min.',
  location_service_area: '1600px wide minimum for photos',
  proof_social_proof: '1000px wide minimum for screenshots',
  video_clips: '720p minimum resolution, 5–60 seconds ideal clip length',
  audio_files: 'Clear voice, low background noise, 44.1 kHz recommended',
  compliance: 'Complete and current text',
  creative_examples: '1000px wide minimum',
};

// Text-only asset types (no file upload needed)
export const TEXT_ASSET_TYPES = [
  'approved_claim', 'forbidden_claim', 'disclaimer', 'font_notes', 'color_palette', 'testimonial_text',
];

// Document asset types (accept text files)
export const DOCUMENT_ASSET_TYPES = [
  'owner_bio_doc', 'founder_story_doc', 'company_history_doc', 'mission_statement_doc',
  'service_area_doc', 'customer_profile_doc', 'differentiators_doc', 'faq_doc',
  'objections_doc', 'brand_voice_doc', 'words_avoid_doc', 'regulatory_doc',
];

// Video asset types
export const VIDEO_ASSET_TYPES = [
  'owner_intro_video', 'testimonial_video', 'service_explainer_video',
  'behind_scenes_video', 'product_demo_video', 'location_walkthrough_video',
  'before_after_video', 'faq_answer_video', 'general_video',
];

// Audio asset types
export const AUDIO_ASSET_TYPES = [
  'owner_interview_audio', 'testimonial_audio', 'voiceover', 'jingle',
  'phone_greeting', 'podcast_clip', 'general_audio',
];

// Intended use options
export const INTENDED_USE_OPTIONS = [
  { value: 'website', label: 'Website' },
  { value: 'social', label: 'Social Posts' },
  { value: 'video', label: 'Video' },
  { value: 'ads', label: 'Ads' },
  { value: 'seo', label: 'SEO Content' },
  { value: 'email', label: 'Email' },
  { value: 'print', label: 'Print' },
  { value: 'internal', label: 'Internal Only' },
];

export const APPROVAL_STATUSES = [
  'uploaded', 'pending_review', 'approved', 'rejected', 'expired', 'do_not_use', 'archived',
] as const;

export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  uploaded: 'Uploaded',
  pending_review: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  do_not_use: 'Do Not Use',
  archived: 'Archived',
};

// Forbidden file extensions
const FORBIDDEN_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.zsh', '.ps1', '.vbs', '.js', '.py',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
];

const FORBIDDEN_MIME_TYPES = [
  'application/x-executable', 'application/x-msdownload',
  'application/x-sh', 'application/x-shellscript',
  'application/zip', 'application/x-rar-compressed',
  'application/x-7z-compressed',
  'text/javascript', 'application/javascript',
];

interface ValidationRule {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
  maxDimensionPx?: number;
  minDimensionPx?: number;
  warningMessage?: string;
}

const KB = 1024;
const MB = 1024 * KB;

const LOGO_RULES: ValidationRule = {
  allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'],
  maxSizeBytes: 2 * MB,
  minDimensionPx: 500,
};

const PHOTO_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeBytes: 10 * MB,
  maxDimensionPx: 8000,
};

const CERT_IMAGE_RULES: ValidationRule = {
  allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg', 'application/pdf'],
  maxSizeBytes: 5 * MB,
};

const MAP_RULES: ValidationRule = {
  allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 5 * MB,
};

const TESTIMONIAL_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 5 * MB,
};

const CREATIVE_EXAMPLE_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 10 * MB,
};

const PDF_RULES: ValidationRule = {
  allowedMimeTypes: ['application/pdf'],
  maxSizeBytes: 10 * MB,
};

const DOCUMENT_RULES: ValidationRule = {
  allowedMimeTypes: [
    'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown', 'text/csv',
  ],
  maxSizeBytes: 10 * MB,
};

const VIDEO_RULES: ValidationRule = {
  allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
  maxSizeBytes: 100 * MB,
};

const AUDIO_RULES: ValidationRule = {
  allowedMimeTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/x-wav'],
  maxSizeBytes: 50 * MB,
};

export function getValidationRules(assetType: string): ValidationRule | null {
  if (TEXT_ASSET_TYPES.includes(assetType)) return null;

  // Logo types
  if (assetType.startsWith('logo_')) return LOGO_RULES;

  // Document types
  if (DOCUMENT_ASSET_TYPES.includes(assetType)) return DOCUMENT_RULES;

  // Video types
  if (VIDEO_ASSET_TYPES.includes(assetType)) return VIDEO_RULES;

  // Audio types
  if (AUDIO_ASSET_TYPES.includes(assetType)) return AUDIO_RULES;

  switch (assetType) {
    case 'logo':
      return LOGO_RULES;
    case 'brand_guidelines':
    case 'usage_rights_doc':
    case 'case_study':
    case 'regulatory_doc':
      return PDF_RULES;
    case 'product_photo':
    case 'service_photo':
    case 'owner_photo':
    case 'staff_photo':
    case 'team_group_photo':
    case 'candid_work_photo':
    case 'storefront_photo':
    case 'facility_photo':
    case 'fleet_photo':
    case 'landmark_photo':
    case 'before_after_photo':
    case 'process_steps_photo':
    case 'equipment_photo':
      return PHOTO_RULES;
    case 'menu_list':
    case 'price_sheet':
    case 'offer_sheet':
      return { ...PHOTO_RULES, allowedMimeTypes: [...PHOTO_RULES.allowedMimeTypes, 'application/pdf'], maxSizeBytes: 5 * MB };
    case 'certification':
    case 'license':
    case 'award':
    case 'press_mention':
      return CERT_IMAGE_RULES;
    case 'service_area_map':
      return MAP_RULES;
    case 'testimonial_screenshot':
    case 'review_screenshot':
      return TESTIMONIAL_RULES;
    case 'existing_ad':
    case 'social_post':
    case 'flyer_brochure':
    case 'website_screenshot':
    case 'negative_example':
      return CREATIVE_EXAMPLE_RULES;
    default:
      return PHOTO_RULES;
  }
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export function validateAssetFile(
  assetType: string,
  fileName: string,
  mimeType: string,
  fileSizeBytes: number,
  width?: number,
  height?: number
): ValidationResult {
  const ext = ('.' + (fileName.split('.').pop() ?? '')).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed.` };
  }
  if (FORBIDDEN_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: `File type "${mimeType}" is not allowed.` };
  }
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return { valid: false, error: 'Invalid filename.' };
  }

  const rules = getValidationRules(assetType);
  if (!rules) return { valid: true };

  if (!rules.allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `File type "${mimeType}" is not allowed for ${assetType}. Accepted: ${rules.allowedMimeTypes.join(', ')}.`,
    };
  }

  if (['certification', 'license', 'award', 'press_mention'].includes(assetType)) {
    if (mimeType !== 'application/pdf' && fileSizeBytes > 2 * MB) {
      return { valid: false, error: 'Image files for certifications/badges must be under 2 MB.' };
    }
  }

  if (fileSizeBytes > rules.maxSizeBytes) {
    const maxMB = Math.round(rules.maxSizeBytes / MB);
    return { valid: false, error: `File size (${(fileSizeBytes / MB).toFixed(1)} MB) exceeds the ${maxMB} MB limit.` };
  }

  if (assetType === 'service_area_map' && mimeType === 'image/svg+xml' && fileSizeBytes > 1 * MB) {
    return { valid: false, error: 'SVG map files must be under 1 MB.' };
  }

  if (assetType.startsWith('logo') && mimeType === 'image/svg+xml' && fileSizeBytes > 500 * KB) {
    return { valid: false, error: 'SVG logos must be under 500 KB.' };
  }

  if (rules.maxDimensionPx && (width || height)) {
    const longest = Math.max(width ?? 0, height ?? 0);
    if (longest > rules.maxDimensionPx) {
      return { valid: false, error: `Image dimensions exceed maximum of ${rules.maxDimensionPx}px.` };
    }
  }

  // Collect warnings
  const warnings: string[] = [];

  // Logo-specific warnings
  if (assetType.startsWith('logo') || assetType === 'logo') {
    if (mimeType === 'image/jpeg') {
      warnings.push('JPEG is not recommended for logos with text because compression can make edges and letters look blurry. PNG with transparent background is preferred.');
    }
    if (mimeType === 'image/svg+xml') {
      warnings.push('SVG is useful as a source logo file, but upload a PNG version too for social platforms, image generation, and video workflows.');
    }
    if (width && height && (width < 500 || height < 500)) {
      warnings.push(`Logo dimensions (${width}×${height}) are below the recommended minimum of 500px. Higher resolution logos produce better results.`);
    }
  }

  // Photo size warnings
  if (PHOTO_RULES.allowedMimeTypes.includes(mimeType) && !assetType.startsWith('logo')) {
    if (width && width < 1000) {
      warnings.push(`Image width (${width}px) is below the recommended minimum of 1000px. Higher resolution photos produce better results.`);
    }
  }

  // Large file warning
  if (!VIDEO_ASSET_TYPES.includes(assetType) && !AUDIO_ASSET_TYPES.includes(assetType)) {
    if (mimeType !== 'application/pdf' && fileSizeBytes > 5 * MB) {
      warnings.push('Consider compressing this file for faster loading.');
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Generate quality warnings for uploaded assets based on file metadata.
 */
export function generateQualityWarnings(
  assetType: string,
  mimeType: string,
  fileSizeBytes: number,
  width?: number,
  height?: number,
  duration?: number,
): string[] {
  const warnings: string[] = [];

  // Logo checks
  if (assetType.startsWith('logo') || assetType === 'logo') {
    if (mimeType === 'image/jpeg') {
      warnings.push('JPEG is not recommended for logos. PNG with transparent background is preferred.');
    }
    if (width && height) {
      if (assetType === 'logo_primary' && width < 1200) warnings.push('Horizontal logo should be at least 1200px wide.');
      if (assetType === 'logo_vertical' && height && height < 1000) warnings.push('Vertical logo should be at least 1000px tall.');
      if ((assetType === 'logo_avatar' || assetType === 'logo_icon') && (width < 1000 || height < 1000)) warnings.push('Square logo/icon should be at least 1000×1000px.');
      if (assetType === 'logo_white' && width < 1200) warnings.push('White/reverse logo should be at least 1200px wide.');
    }
  }

  // Photo checks
  if (mimeType?.startsWith('image/') && !assetType.startsWith('logo')) {
    if (width && width < 1000) warnings.push('Image resolution is low. Recommended minimum is 1000px wide.');
    if (fileSizeBytes < 20 * KB && width && width < 500) warnings.push('This may be a screenshot or thumbnail. Upload a higher quality version if available.');
  }

  // Video checks
  if (VIDEO_ASSET_TYPES.includes(assetType)) {
    if (width && width < 720) warnings.push('Video resolution is below 720p. Higher resolution recommended.');
    if (duration && duration > 300) warnings.push('Clip is over 5 minutes. Shorter clips (10–60 seconds) work best for social content.');
    if (duration && duration < 3) warnings.push('Clip is very short (under 3 seconds). May be too brief for most uses.');
  }

  // Audio checks
  if (AUDIO_ASSET_TYPES.includes(assetType)) {
    if (duration && duration > 600) warnings.push('Audio clip is over 10 minutes. Consider trimming to key segments.');
  }

  // Document checks
  if (DOCUMENT_ASSET_TYPES.includes(assetType)) {
    if (fileSizeBytes < 100) warnings.push('Document appears to be very short or empty.');
  }

  return warnings;
}

/**
 * Sanitize SVG content to remove scripts, event handlers, and external references.
 */
export function sanitizeSvg(svgContent: string): { safe: boolean; sanitized?: string; error?: string } {
  if (/<script[\s>]/i.test(svgContent)) return { safe: false, error: 'SVG contains script tags.' };
  if (/javascript:/i.test(svgContent)) return { safe: false, error: 'SVG contains JavaScript references.' };
  if (/data:text\/(html|javascript)/i.test(svgContent)) return { safe: false, error: 'SVG contains dangerous data URIs.' };

  let cleaned = svgContent;
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*\/>/gi, '');
  cleaned = cleaned.replace(/<foreignObject[^>]*>[\s\S]*?<\/foreignObject>/gi, '');
  cleaned = cleaned.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, '');
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
  cleaned = cleaned.replace(/xlink:href\s*=\s*["'](https?:\/\/[^"']*)["']/gi, '');
  cleaned = cleaned.replace(/<set[^>]*attributeName\s*=\s*["']on\w+["'][^>]*\/>/gi, '');

  return { safe: true, sanitized: cleaned };
}

/**
 * Brand readiness categories and scoring
 */
export interface ReadinessItem {
  category: AssetCategory;
  label: string;
  required: boolean;
  status: 'missing' | 'uploaded' | 'needs_review' | 'low_quality' | 'ready';
  count: number;
}

export function computeReadinessScore(items: ReadinessItem[]): number {
  const requiredItems = items.filter(i => i.required);
  const optionalItems = items.filter(i => !i.required);
  let score = 0;
  const requiredWeight = 80; // 80% from required items
  const optionalWeight = 20; // 20% from optional items

  if (requiredItems.length > 0) {
    const requiredReady = requiredItems.filter(i => i.status === 'ready' || i.status === 'uploaded').length;
    score += (requiredReady / requiredItems.length) * requiredWeight;
  }
  if (optionalItems.length > 0) {
    const optionalReady = optionalItems.filter(i => i.status === 'ready' || i.status === 'uploaded').length;
    score += (optionalReady / optionalItems.length) * optionalWeight;
  }
  return Math.round(score);
}

export function getReadinessLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Complete', color: 'text-green-700 bg-green-100' };
  if (score >= 70) return { label: 'Strong', color: 'text-blue-700 bg-blue-100' };
  if (score >= 40) return { label: 'Basic', color: 'text-amber-700 bg-amber-100' };
  return { label: 'Incomplete', color: 'text-red-700 bg-red-100' };
}
