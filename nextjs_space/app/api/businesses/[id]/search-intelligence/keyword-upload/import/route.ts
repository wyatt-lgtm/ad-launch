export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { prisma } from '@/lib/db';
import { sanitizeText, normalizeKeywordLocal, MAX_ROWS } from '@/lib/keyword-import-parser';

/**
 * POST /api/businesses/[id]/search-intelligence/keyword-upload/import
 *
 * Accepts parsed rows (from the preview step) and writes business-scoped
 * keyword + location records. Skips duplicates. Records an audit batch.
 * NEVER triggers a provider/DataForSEO search — import is write-only.
 */
interface IncomingRow {
  rowNumber?: number;
  rawKeyword?: string;
  rawLocation?: string;
  parsedKeyword?: string;
  keyword?: string;
  locationType?: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  priority?: string;
  serviceLine?: string | null;
  marketOrientation?: string;
  intent?: string | null;
  status?: string;
}

function locKey(l: { zip?: string | null; city?: string | null; state?: string | null; locationType?: string | null }): string {
  if (l.zip) return `zip:${l.zip}`;
  if (l.city || l.state) return `cs:${(l.city || '').toLowerCase()},${(l.state || '').toLowerCase()}`;
  return `lt:${l.locationType || 'unknown'}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const session = await getServerSession(authOptions);
  const uploadedByUserId = r.user.id;
  void session;

  const body = await req.json().catch(() => ({}));
  const incoming: IncomingRow[] = Array.isArray(body.rows) ? body.rows : [];
  const fileName: string | null = body.fileName ? String(body.fileName).slice(0, 200) : null;
  const fileType: string | null = body.fileType ? String(body.fileType).slice(0, 10) : null;

  if (incoming.length === 0) {
    return NextResponse.json({ error: 'No rows to import.' }, { status: 400 });
  }
  if (incoming.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows. Maximum is ${MAX_ROWS} per upload.` }, { status: 400 });
  }

  // Preload existing keywords/locations for dedupe.
  const [existingKeywords, existingLocations] = await Promise.all([
    prisma.searchIntelligenceKeyword.findMany({ where: { businessId }, select: { id: true, normalizedKeyword: true } }),
    prisma.searchIntelligenceLocation.findMany({ where: { businessId }, select: { id: true, zip: true, city: true, state: true, locationType: true } }),
  ]);
  const kwMap = new Map(existingKeywords.map((k) => [k.normalizedKeyword, k.id]));
  const locMap = new Map(existingLocations.map((l) => [locKey(l), l.id]));

  let importedCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let needsReviewCount = 0;
  let keywordCreated = 0;
  let locationCreated = 0;
  const rowResults: any[] = [];

  // Track keys created within THIS batch to avoid intra-batch duplicate inserts.
  const batchKwKeys = new Set<string>();
  const batchLocKeys = new Set<string>();

  for (const row of incoming) {
    const parsedKeyword = sanitizeText(row.parsedKeyword || row.rawKeyword || row.keyword || '');
    const normalized = normalizeKeywordLocal(parsedKeyword);
    const zip = row.zip ? sanitizeText(row.zip) : null;
    const city = row.city ? sanitizeText(row.city) : null;
    const state = row.state ? sanitizeText(row.state) : null;
    const county = row.county ? sanitizeText(row.county) : null;
    const locationType = (row.locationType && String(row.locationType)) || (zip ? 'zip' : city ? 'city' : 'unknown');
    const hasLocation = !!(zip || city || county || state || locationType === 'national');

    // Server-side re-validation (never trust client status alone).
    if (!parsedKeyword) {
      invalidCount++;
      rowResults.push({ rowNumber: row.rowNumber ?? null, keyword: parsedKeyword, status: 'invalid', error: 'Missing keyword' });
      continue;
    }
    if (!hasLocation) {
      invalidCount++;
      rowResults.push({ rowNumber: row.rowNumber ?? null, keyword: parsedKeyword, status: 'invalid', error: 'Missing location' });
      continue;
    }

    const lk = locKey({ zip, city, state, locationType });
    const kwExists = kwMap.has(normalized) || batchKwKeys.has(normalized);
    const locExists = locMap.has(lk) || batchLocKeys.has(lk);
    if (kwExists && locExists) {
      duplicateCount++;
      rowResults.push({ rowNumber: row.rowNumber ?? null, keyword: parsedKeyword, status: 'duplicate', error: 'Keyword + location already tracked' });
      continue;
    }

    // Create keyword if new.
    if (!kwExists) {
      const created = await prisma.searchIntelligenceKeyword.create({
        data: {
          businessId,
          keyword: parsedKeyword,
          normalizedKeyword: normalized,
          serviceLine: row.serviceLine ? sanitizeText(row.serviceLine) : null,
          marketOrientation: row.marketOrientation || 'unknown',
          keywordIntent: row.intent ? sanitizeText(row.intent) : 'service',
          funnelStage: 'consideration',
          priority: row.priority || 'medium',
          source: 'bulk_import',
          status: 'active',
        } as any,
      });
      kwMap.set(normalized, created.id);
      batchKwKeys.add(normalized);
      keywordCreated++;
    }

    // Create location if new.
    if (!locExists) {
      const created = await prisma.searchIntelligenceLocation.create({
        data: {
          businessId,
          locationType: locationType === 'unknown' ? (zip ? 'zip' : city ? 'city' : 'custom') : locationType,
          zip: zip || null,
          city: city || null,
          state: state || null,
          county: county || null,
          serviceAreaPriority: row.priority || 'medium',
          marketLabel: [city, state].filter(Boolean).join(', ') || zip || null,
          status: 'active',
        } as any,
      });
      locMap.set(lk, created.id);
      batchLocKeys.add(lk);
      locationCreated++;
    }

    importedCount++;
    if (row.status === 'needs_review') needsReviewCount++;
    rowResults.push({ rowNumber: row.rowNumber ?? null, keyword: parsedKeyword, status: 'imported', locationText: [city, state].filter(Boolean).join(', ') || zip || locationType });
  }

  // Audit batch record.
  const batch = await prisma.searchIntelligenceKeywordImport.create({
    data: {
      businessId,
      uploadedByUserId,
      fileName,
      fileType,
      rowCount: incoming.length,
      importedCount,
      duplicateCount,
      needsReviewCount,
      invalidCount,
      keywordCreated,
      locationCreated,
      status: invalidCount === incoming.length ? 'failed' : (invalidCount > 0 || duplicateCount > 0 ? 'partial' : 'completed'),
      errorSummary: invalidCount > 0 ? `${invalidCount} invalid row(s) skipped` : null,
      rowsJson: rowResults as any,
    } as any,
  });

  return NextResponse.json({
    ok: true,
    importId: batch.id,
    summary: {
      imported: importedCount,
      duplicatesSkipped: duplicateCount,
      needsReview: needsReviewCount,
      invalidRejected: invalidCount,
      keywordsCreated: keywordCreated,
      locationsCreated: locationCreated,
    },
    rows: rowResults,
  });
}
