const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// ── Credential tiers ──────────────────────────────────────────────
//  MASTER  = GHL_MASTER_API_TOKEN / GHL_MASTER_LOCATION_ID  → account creation / CRM
//  SUBTENANT = GHL_API_TOKEN / GHL_LOCATION_ID               → transactional email & customer follow-up
type GhlTier = 'master' | 'subtenant';

function getCredentials(tier: GhlTier = 'subtenant') {
  if (tier === 'master') {
    return {
      token: process.env.GHL_MASTER_API_TOKEN ?? process.env.GHL_API_TOKEN ?? '',
      locationId: process.env.GHL_MASTER_LOCATION_ID ?? process.env.GHL_LOCATION_ID ?? '',
    };
  }
  // subtenant — fall back to master if subtenant vars aren't set
  return {
    token: process.env.GHL_API_TOKEN ?? process.env.GHL_MASTER_API_TOKEN ?? '',
    locationId: process.env.GHL_LOCATION_ID ?? process.env.GHL_MASTER_LOCATION_ID ?? '',
  };
}

function getHeaders(tier: GhlTier = 'subtenant') {
  return {
    'Authorization': `Bearer ${getCredentials(tier).token}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
}

/**
 * Create or resolve a GHL contact.
 * @param tier  'master' for account-creation CRM tracking,
 *              'subtenant' for transactional email (default)
 */
export async function createGHLContact(email: string, name?: string, tier: GhlTier = 'subtenant') {
  const creds = getCredentials(tier);
  try {
    const res = await fetch(`${GHL_BASE_URL}/contacts/`, {
      method: 'POST',
      headers: getHeaders(tier),
      body: JSON.stringify({
        email,
        name: name ?? email?.split('@')?.[0] ?? 'User',
        locationId: creds.locationId,
        source: 'Launch OS',
        tags: ['ad-launch', 'free-trial'],
      }),
    });
    const data = await res.json().catch(() => ({}));

    // GHL returns contactId in data.contact.id on success (200/201)
    // but in data.meta.contactId on duplicate (400 "does not allow duplicated contacts")
    const contactId = data?.contact?.id ?? data?.meta?.contactId ?? null;
    if (contactId) {
      console.log(`[GHL:${tier}] Contact resolved:`, contactId, res.ok ? '(created)' : '(existing)');
    }
    return { success: true, data, contactId };
  } catch (err: any) {
    console.error(`[GHL:${tier}] create contact error:`, err?.message);
    return { success: false, data: null, contactId: null };
  }
}

/**
 * Send an email through GHL conversations API.
 * Always uses subtenant credentials (transactional email).
 */
export async function sendGHLEmail(contactId: string, subject: string, htmlBody: string) {
  try {
    const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
      method: 'POST',
      headers: getHeaders('subtenant'),
      body: JSON.stringify({
        type: 'Email',
        contactId,
        subject,
        html: htmlBody,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err: any) {
    console.error('[GHL:subtenant] send email error:', err?.message);
    return { success: false, data: null };
  }
}

// ── GHL Location / Sub-account Provisioning ─────────────────────────

interface ProvisionInput {
  businessName: string;
  businessAddr?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessZip?: string | null;
  businessPhone?: string | null;
  websiteUrl?: string | null;
  ownerEmail?: string | null;
}

export interface ProvisionResult {
  success: boolean;
  locationId?: string;
  subtenantId?: string;
  error?: string;
}

/**
 * Provision a GHL Location (sub-account) for a business.
 * Uses the master / agency API token with POST /locations.
 *
 * This is idempotent on the caller side — the API route checks
 * whether the business already has ghlLocationId before calling.
 */
export async function provisionGhlLocation(input: ProvisionInput): Promise<ProvisionResult> {
  const creds = getCredentials('master');
  if (!creds.token) {
    return { success: false, error: 'GHL master API token not configured' };
  }

  try {
    const body: Record<string, any> = {
      name: input.businessName,
      companyId: creds.locationId, // parent company / agency ID
    };
    if (input.businessAddr) body.address = input.businessAddr;
    if (input.businessCity) body.city = input.businessCity;
    if (input.businessState) body.state = input.businessState;
    if (input.businessZip) body.postalCode = input.businessZip;
    if (input.businessPhone) body.phone = input.businessPhone;
    if (input.websiteUrl) body.website = input.websiteUrl;
    if (input.ownerEmail) body.email = input.ownerEmail;

    const res = await fetch(`${GHL_BASE_URL}/locations`, {
      method: 'POST',
      headers: getHeaders('master'),
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = data?.message || data?.msg || JSON.stringify(data) || `HTTP ${res.status}`;
      console.error('[GHL] provision location failed:', res.status, errMsg);
      return { success: false, error: errMsg };
    }

    const locationId = data?.location?.id ?? data?.id ?? null;
    // Some GHL API versions nest a "subAccount" or use the location id itself
    const subtenantId = data?.location?.companyId ?? data?.subAccountId ?? locationId;

    if (!locationId) {
      console.error('[GHL] provision response missing location id:', data);
      return { success: false, error: 'GHL API did not return a location ID' };
    }

    console.log('[GHL] location provisioned:', locationId);
    return { success: true, locationId, subtenantId: subtenantId ?? undefined };
  } catch (err: any) {
    console.error('[GHL] provision location error:', err?.message);
    return { success: false, error: err?.message ?? 'Unknown provisioning error' };
  }
}

export async function sendConfirmationEmail(email: string, confirmationToken: string, baseUrl: string) {
  const contactResult = await createGHLContact(email);
  const confirmLink = `${baseUrl}/confirm?token=${confirmationToken}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563EB; margin: 0;">Launch OS</h1>
      </div>
      <h2 style="color: #1E293B;">Confirm Your Email</h2>
      <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hi there!</p>
      <p style="color: #475569; font-size: 16px; line-height: 1.6;">Click the button below to confirm your email and download your <strong>3 free ads</strong>:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${confirmLink}" style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Confirm My Email</a>
      </div>
      <p style="color: #94A3B8; font-size: 14px;">If the button doesn't work, copy and paste this link:<br/>${confirmLink}</p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
      <p style="color: #94A3B8; font-size: 12px; text-align: center;">Thanks,<br/>The Launch OS Team</p>
    </div>
  `;

  if (contactResult.contactId) {
    return sendGHLEmail(contactResult.contactId, 'Confirm your email - Launch OS', htmlBody);
  }
  return { success: false, data: null, error: 'Failed to create contact' };
}

// ═══════════════════════════════════════════════════════════════
// GHL Location Lookup (validate existing location)
// ═══════════════════════════════════════════════════════════════

export interface GhlLocationInfo {
  exists: boolean;
  locationId?: string;
  name?: string;
  error?: string;
}

/**
 * Look up a GHL location by ID using the master/agency API.
 * Returns location info if found, or exists=false if not.
 */
export async function lookupGhlLocation(locationId: string): Promise<GhlLocationInfo> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}`, {
      method: 'GET',
      headers: getHeaders('master'),
    });
    if (res.status === 404 || res.status === 422) {
      return { exists: false, error: 'Location not found in GHL' };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[GHL lookup] ${res.status}: ${text}`);
      return { exists: false, error: `GHL API error: ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const loc = data.location || data;
    return {
      exists: true,
      locationId: loc.id || locationId,
      name: loc.name || loc.businessName || undefined,
    };
  } catch (err: any) {
    console.error('[GHL lookup] error:', err);
    return { exists: false, error: err.message || 'Network error' };
  }
}

/**
 * Search GHL locations by name/domain using the master API.
 */
export async function searchGhlLocations(query: string): Promise<{ locations: { id: string; name: string; domain?: string }[]; error?: string }> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/locations/search?query=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: getHeaders('master'),
    });
    if (!res.ok) {
      // Fallback: search may not be supported — return empty
      return { locations: [] };
    }
    const data = await res.json().catch(() => ({}));
    const locs = (data.locations || []).map((l: any) => ({
      id: l.id,
      name: l.name || l.businessName || '',
      domain: l.website || l.domain || undefined,
    }));
    return { locations: locs };
  } catch (err: any) {
    return { locations: [], error: err.message };
  }
}
