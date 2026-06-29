export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { prisma } from '@/lib/db';
import {
  parseKeywordFile,
  enrichRowsWithZip,
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS,
  type ParsedRow,
  type ZipResolver,
} from '@/lib/keyword-import-parser';
import { getZipDetails } from '@/lib/rss/geo-lookup';

/**
 * POST /api/businesses/[id]/search-intelligence/keyword-upload/preview
 *
 * Parses an uploaded keyword/location file, validates each row, resolves ZIPs
 * to city/state/county where possible, flags duplicates (in-file AND against
 * existing business-scoped keyword+location records) and returns the parsed
 * rows for preview. Writes NOTHING. Never triggers a provider search.
 */
const zipResolver: ZipResolver = async (zip) => {
  const d = await getZipDetails(zip).catch(() => null);
  if (!d) return null;
  return { city: d.primaryCity ?? null, state: d.state ?? null, county: d.county ?? null };
};

function locKey(row: { zip: string | null; city: string | null; state: string | null; locationType: string }): string {
  if (row.zip) return `zip:${row.zip}`;
  if (row.city || row.state) return `cs:${(row.city || '').toLowerCase()},${(row.state || '').toLowerCase()}`;
  return `lt:${row.locationType}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  // Read multipart file
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f && typeof f !== 'string') file = f as File;
  } catch {
    return NextResponse.json({ error: 'Invalid upload. Expected a file.' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `File is too large. Maximum size is 1 MB.` }, { status: 400 });
  }
  const fileName = (file.name || 'upload.csv').slice(0, 200);

  let content = '';
  try {
    content = Buffer.from(await file.arrayBuffer()).toString('utf-8');
  } catch {
    return NextResponse.json({ error: 'Could not read the uploaded file.' }, { status: 400 });
  }

  const result = parseKeywordFile(content, fileName);
  if (result.fatalError) {
    return NextResponse.json({ error: result.fatalError, fileType: result.fileType, totalRows: result.totalRows }, { status: 400 });
  }

  // Resolve ZIPs -> city/state/county where missing
  await enrichRowsWithZip(result.rows, zipResolver);

  // Cross-check against EXISTING business-scoped keywords + locations for dupes.
  const [existingKeywords, existingLocations] = await Promise.all([
    prisma.searchIntelligenceKeyword.findMany({ where: { businessId }, select: { normalizedKeyword: true } }),
    prisma.searchIntelligenceLocation.findMany({ where: { businessId }, select: { zip: true, city: true, state: true, locationType: true } }),
  ]);
  const existingKwSet = new Set(existingKeywords.map((k) => k.normalizedKeyword));
  const existingLocSet = new Set(existingLocations.map((l) => locKey({ zip: l.zip, city: l.city, state: l.state, locationType: l.locationType })));

  for (const row of result.rows) {
    if (row.status === 'ready' || row.status === 'needs_review') {
      const kwDup = existingKwSet.has(row.normalizedKeyword);
      const locDup = existingLocSet.has(locKey(row));
      // A row is a duplicate only if BOTH its keyword and its location already exist.
      if (kwDup && locDup) {
        row.status = 'duplicate';
        row.error = 'Keyword + location already tracked';
      }
    }
  }

  const summary = summarize(result.rows);
  return NextResponse.json({
    ok: true,
    fileName,
    fileType: result.fileType,
    totalRows: result.totalRows,
    maxRows: MAX_ROWS,
    rows: result.rows,
    summary,
  });
}

function summarize(rows: ParsedRow[]) {
  return {
    ready: rows.filter((r) => r.status === 'ready').length,
    needsReview: rows.filter((r) => r.status === 'needs_review').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    overLimit: rows.filter((r) => r.status === 'over_limit').length,
    total: rows.length,
  };
}
