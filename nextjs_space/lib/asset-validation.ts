/**
 * Asset validation rules for Creative Asset Library.
 * Enforces file type, size, and dimension limits per asset type/category.
 */

export const ASSET_CATEGORIES = [
  'brand',
  'products_services',
  'people_trust',
  'location_service_area',
  'proof_social_proof',
  'compliance',
  'creative_examples',
] as const;

export type AssetCategory = typeof ASSET_CATEGORIES[number];

export const ASSET_TYPES: Record<AssetCategory, { value: string; label: string }[]> = {
  brand: [
    { value: 'logo', label: 'Logo' },
    { value: 'color_palette', label: 'Brand Color Palette' },
    { value: 'font_notes', label: 'Font / Typography Notes' },
    { value: 'brand_guidelines', label: 'Brand Guidelines' },
  ],
  products_services: [
    { value: 'product_photo', label: 'Product Photo' },
    { value: 'service_photo', label: 'Service Photo' },
    { value: 'menu_list', label: 'Menu / Service List' },
    { value: 'price_sheet', label: 'Price Sheet' },
    { value: 'offer_sheet', label: 'Offer Sheet' },
  ],
  people_trust: [
    { value: 'owner_photo', label: 'Owner / Founder Photo' },
    { value: 'staff_photo', label: 'Staff / Team Photo' },
    { value: 'certification', label: 'Certification / Badge' },
    { value: 'license', label: 'License' },
    { value: 'award', label: 'Award' },
    { value: 'press_mention', label: 'Press Mention' },
  ],
  location_service_area: [
    { value: 'storefront_photo', label: 'Storefront Photo' },
    { value: 'facility_photo', label: 'Facility Photo' },
    { value: 'fleet_photo', label: 'Fleet / Vehicle Photo' },
    { value: 'service_area_map', label: 'Service Area Map' },
    { value: 'landmark_photo', label: 'Local Landmark Photo' },
  ],
  proof_social_proof: [
    { value: 'before_after_photo', label: 'Before / After Photo' },
    { value: 'testimonial_screenshot', label: 'Customer Testimonial Screenshot' },
    { value: 'review_screenshot', label: 'Review Screenshot' },
    { value: 'case_study', label: 'Case Study PDF' },
  ],
  compliance: [
    { value: 'approved_claim', label: 'Approved Claim' },
    { value: 'forbidden_claim', label: 'Forbidden / No-Go Claim' },
    { value: 'disclaimer', label: 'Required Disclaimer' },
    { value: 'usage_rights_doc', label: 'Usage Rights Documentation' },
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
  brand: 'Brand',
  products_services: 'Products & Services',
  people_trust: 'People & Trust',
  location_service_area: 'Location & Service Area',
  proof_social_proof: 'Proof & Social Proof',
  compliance: 'Compliance',
  creative_examples: 'Creative Examples',
};

// Text-only asset types (no file upload needed)
export const TEXT_ASSET_TYPES = ['approved_claim', 'forbidden_claim', 'disclaimer', 'font_notes', 'color_palette'];

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
  '.heic', '.heif', // unless server-side conversion
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
  maxSizeBytes: 1 * MB,
  minDimensionPx: 512,
};

const PHOTO_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeBytes: 5 * MB,
  maxDimensionPx: 6000,
};

const CERT_IMAGE_RULES: ValidationRule = {
  allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg', 'application/pdf'],
  maxSizeBytes: 5 * MB, // 2MB for images, 5MB for PDF - checked separately
};

const MAP_RULES: ValidationRule = {
  allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 5 * MB,
};

const TESTIMONIAL_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 3 * MB,
};

const CREATIVE_EXAMPLE_RULES: ValidationRule = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 10 * MB,
};

const PDF_RULES: ValidationRule = {
  allowedMimeTypes: ['application/pdf'],
  maxSizeBytes: 5 * MB,
};

export function getValidationRules(assetType: string): ValidationRule | null {
  // Text-only types have no file validation
  if (TEXT_ASSET_TYPES.includes(assetType)) return null;

  switch (assetType) {
    case 'logo':
      return LOGO_RULES;
    case 'brand_guidelines':
    case 'usage_rights_doc':
    case 'case_study':
      return PDF_RULES;
    case 'product_photo':
    case 'service_photo':
    case 'owner_photo':
    case 'staff_photo':
    case 'storefront_photo':
    case 'facility_photo':
    case 'fleet_photo':
    case 'landmark_photo':
    case 'before_after_photo':
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
      return PHOTO_RULES; // safe default
  }
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

export function validateAssetFile(
  assetType: string,
  fileName: string,
  mimeType: string,
  fileSizeBytes: number,
  width?: number,
  height?: number
): ValidationResult {
  // Check forbidden extensions
  const ext = ('.' + (fileName.split('.').pop() ?? '')).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed.` };
  }

  // Check forbidden MIME types
  if (FORBIDDEN_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: `File type "${mimeType}" is not allowed.` };
  }

  // Check for path traversal in filename
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return { valid: false, error: 'Invalid filename.' };
  }

  const rules = getValidationRules(assetType);
  if (!rules) {
    // Text-only type, no file validation
    return { valid: true };
  }

  // Check MIME type
  if (!rules.allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `File type "${mimeType}" is not allowed for ${assetType}. Accepted: ${rules.allowedMimeTypes.join(', ')}.`,
    };
  }

  // Special size checks for certification images vs PDF
  if (['certification', 'license', 'award', 'press_mention'].includes(assetType)) {
    if (mimeType !== 'application/pdf' && fileSizeBytes > 2 * MB) {
      return { valid: false, error: 'Image files for certifications/badges must be under 2 MB.' };
    }
  }

  // Check file size
  if (fileSizeBytes > rules.maxSizeBytes) {
    const maxMB = Math.round(rules.maxSizeBytes / MB);
    return { valid: false, error: `File size (${(fileSizeBytes / MB).toFixed(1)} MB) exceeds the ${maxMB} MB limit for ${assetType}.` };
  }

  // Check SVG size for maps
  if (assetType === 'service_area_map' && mimeType === 'image/svg+xml' && fileSizeBytes > 1 * MB) {
    return { valid: false, error: 'SVG map files must be under 1 MB.' };
  }

  // Logo SVG max 500KB
  if (assetType === 'logo' && mimeType === 'image/svg+xml' && fileSizeBytes > 500 * KB) {
    return { valid: false, error: 'SVG logos must be under 500 KB.' };
  }

  // Dimension checks
  if (rules.maxDimensionPx && (width || height)) {
    const longest = Math.max(width ?? 0, height ?? 0);
    if (longest > rules.maxDimensionPx) {
      return { valid: false, error: `Image dimensions exceed maximum of ${rules.maxDimensionPx}px on longest side.` };
    }
  }

  if (rules.minDimensionPx && (width || height)) {
    const longest = Math.max(width ?? 0, height ?? 0);
    if (longest < rules.minDimensionPx) {
      return { valid: false, error: `Logo should be at least ${rules.minDimensionPx}px on the longest side.` };
    }
  }

  // Warnings
  let warning: string | undefined;
  if (assetType === 'logo' && mimeType === 'image/jpeg') {
    warning = 'For logos, SVG or transparent PNG is preferred over JPEG.';
  }
  if (mimeType !== 'application/pdf' && fileSizeBytes > 3 * MB) {
    warning = (warning ? warning + ' ' : '') + 'Consider compressing this image for faster loading.';
  }

  return { valid: true, warning };
}

/**
 * Sanitize SVG content to remove scripts, event handlers, and external references.
 * Returns sanitized SVG string or null if the SVG is too dangerous.
 */
export function sanitizeSvg(svgContent: string): { safe: boolean; sanitized?: string; error?: string } {
  // Check for script tags
  if (/<script[\s>]/i.test(svgContent)) {
    return { safe: false, error: 'SVG contains script tags.' };
  }

  // Check for embedded JavaScript in various forms
  if (/javascript:/i.test(svgContent)) {
    return { safe: false, error: 'SVG contains JavaScript references.' };
  }

  // Check for data URIs that could contain scripts
  if (/data:text\/(html|javascript)/i.test(svgContent)) {
    return { safe: false, error: 'SVG contains dangerous data URIs.' };
  }

  let cleaned = svgContent;

  // Remove event handler attributes (on*)
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove <script> elements entirely (including CDATA)
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*\/>/gi, '');

  // Remove <foreignObject> (can embed HTML)
  cleaned = cleaned.replace(/<foreignObject[^>]*>[\s\S]*?<\/foreignObject>/gi, '');

  // Remove xlink:href with javascript:
  cleaned = cleaned.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // Remove href with javascript:
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // Remove external URL references (xlink:href to http/https except known safe CDNs)
  // Keep internal references (#id) and data URIs for embedded images
  cleaned = cleaned.replace(
    /xlink:href\s*=\s*["'](https?:\/\/[^"']*)["']/gi,
    ''
  );

  // Remove set/animate with dangerous values
  cleaned = cleaned.replace(/<set[^>]*attributeName\s*=\s*["']on\w+["'][^>]*\/>/gi, '');

  return { safe: true, sanitized: cleaned };
}
