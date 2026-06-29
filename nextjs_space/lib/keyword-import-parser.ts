/**
 * Keyword / Location bulk file import parser.
 *
 * Pure, dependency-light parsing + validation for uploaded keyword/location
 * files (CSV / TSV / TXT). XLSX is intentionally NOT supported here because the
 * project has no XLSX parsing dependency installed (adding one was declined to
 * avoid a new dependency).
 *
 * Design notes:
 *  - All core parsing/validation functions are synchronous & DB-free so they can
 *    be unit-tested without a database.
 *  - ZIP -> city/state/county enrichment is injected via an async resolver
 *    (see `enrichRowsWithZip`) so the pure parser stays testable.
 *  - Formula-injection is guarded for any value rendered/exported.
 */
import { parse as csvParse } from 'csv-parse/sync';

export const MAX_ROWS = 30;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB

export type SupportedFileType = 'csv' | 'tsv' | 'txt';
export type RowStatus = 'ready' | 'duplicate' | 'needs_review' | 'invalid' | 'over_limit';
export type LocationType = 'zip' | 'city' | 'county' | 'state' | 'national' | 'unknown';

export interface ParsedRow {
  rowNumber: number;
  rawKeyword: string;
  rawLocation: string;
  /** Display-safe (formula-injection escaped) keyword for UI/export. */
  keyword: string;
  /** Clean keyword used for storage. */
  parsedKeyword: string;
  normalizedKeyword: string;
  locationText: string;
  locationType: LocationType;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  priority: string; // low | medium | high | critical
  serviceLine: string | null;
  marketOrientation: string; // b2c | b2b | mixed | unknown
  intent: string | null; // keyword intent
  status: RowStatus;
  error: string | null; // error or warning message
}

export interface ParseResult {
  fileType: SupportedFileType;
  rows: ParsedRow[];
  totalRows: number; // non-blank data rows found
  validRows: number; // rows eligible for import (ready or needs_review)
  fatalError: string | null; // set when the whole file is rejected
}

// ── US state lookup ────────────────────────────────────────────────
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};
const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_MARKET = new Set(['b2c', 'b2b', 'mixed', 'unknown']);

// ── Sanitization & formula-injection guard ─────────────────────────
/**
 * Escape a cell value to prevent CSV/spreadsheet formula injection.
 * Per OWASP: if a value begins with = + - @ (or tab/CR), prefix with a single
 * quote so spreadsheet software treats it as text, never a formula.
 */
export function escapeFormulaInjection(value: string | null | undefined): string {
  const s = (value ?? '').toString();
  if (s.length === 0) return s;
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

/** Strip control chars and collapse whitespace; safe for storage. */
export function sanitizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toString()
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKeywordLocal(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// ── File-type detection ────────────────────────────────────────────
export function detectFileType(fileName: string, sample: string): SupportedFileType | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv') return 'tsv';
  if (ext === 'txt') return 'txt';
  // Unknown extension: sniff content. Tab-dominant -> tsv, comma-dominant -> csv.
  if (!ext || ext === fileName.toLowerCase()) {
    const firstLine = (sample.split(/\r?\n/).find((l) => l.trim()) || '');
    if (firstLine.includes('\t')) return 'tsv';
    if (firstLine.includes(',')) return 'csv';
    return 'txt';
  }
  return null; // unsupported (e.g. xlsx, pdf, docx)
}

// ── Raw cell-matrix extraction ─────────────────────────────────────
interface RawRecord {
  keyword: string;
  location: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  priority?: string;
  serviceLine?: string;
  marketOrientation?: string;
  intent?: string;
}

const HEADER_ALIASES: Record<string, keyof RawRecord> = {
  keyword: 'keyword', keywords: 'keyword', term: 'keyword', query: 'keyword',
  location: 'location', loc: 'location', area: 'location',
  city: 'city', town: 'city',
  state: 'state', st: 'state',
  zip: 'zip', zipcode: 'zip', zip_code: 'zip', postal: 'zip', postal_code: 'zip',
  county: 'county',
  priority: 'priority',
  service_line: 'serviceLine', serviceline: 'serviceLine', service: 'serviceLine',
  market_orientation: 'marketOrientation', market: 'marketOrientation', marketorientation: 'marketOrientation',
  intent: 'intent', keyword_intent: 'intent', keywordintent: 'intent',
};

function toMatrix(content: string, fileType: SupportedFileType): string[][] {
  if (fileType === 'txt') {
    // Each non-blank line: split on tab if present, else on the first comma.
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
        const idx = line.indexOf(',');
        if (idx === -1) return [line.trim()];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      });
  }
  const delimiter = fileType === 'tsv' ? '\t' : ',';
  const records = csvParse(content, {
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    bom: true,
  }) as string[][];
  return records.filter((r) => r.some((c) => (c ?? '').toString().trim().length > 0));
}

function matrixToRecords(matrix: string[][]): RawRecord[] {
  if (matrix.length === 0) return [];
  // Header detection: a row whose cells map to known header aliases AND contains
  // a 'keyword' column.
  const first = matrix[0].map((c) => sanitizeText(c).toLowerCase().replace(/\s+/g, '_'));
  const mapped = first.map((c) => HEADER_ALIASES[c]);
  const hasKeywordHeader = mapped.includes('keyword');
  let colMap: (keyof RawRecord | undefined)[];
  let dataRows: string[][];
  if (hasKeywordHeader) {
    colMap = mapped;
    dataRows = matrix.slice(1);
  } else {
    // No header: assume [keyword, location]
    colMap = ['keyword', 'location'];
    dataRows = matrix;
  }
  const records: RawRecord[] = [];
  for (const row of dataRows) {
    const rec: RawRecord = { keyword: '', location: '' };
    row.forEach((cell, i) => {
      const key = colMap[i];
      if (!key) return;
      (rec as any)[key] = sanitizeText(cell);
    });
    records.push(rec);
  }
  return records;
}

// ── Location parsing ───────────────────────────────────────────────
export interface ParsedLocation {
  locationType: LocationType;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  locationText: string;
  needsReview: boolean;
}

function isZip(s: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(s.trim());
}
function stateCode(token: string): string | null {
  const t = token.trim();
  if (/^[A-Za-z]{2}$/.test(t) && US_STATES[t.toUpperCase()]) return t.toUpperCase();
  const byName = STATE_NAME_TO_CODE[t.toLowerCase()];
  return byName || null;
}

/**
 * Parse a location from free-text plus any explicit expanded columns.
 * Explicit columns (city/state/zip/county) take precedence over free text.
 */
export function parseLocation(rec: {
  location?: string; city?: string; state?: string; zip?: string; county?: string;
}): ParsedLocation {
  const explicitCity = sanitizeText(rec.city) || null;
  const explicitState = rec.state ? stateCode(sanitizeText(rec.state)) || sanitizeText(rec.state).toUpperCase() : null;
  const explicitZipRaw = sanitizeText(rec.zip);
  const explicitZip = explicitZipRaw && isZip(explicitZipRaw) ? explicitZipRaw.slice(0, 5) : (explicitZipRaw || null);
  const explicitCounty = sanitizeText(rec.county) || null;
  const freeText = sanitizeText(rec.location);

  // 1) Explicit expanded columns present
  if (explicitZip && isZip(explicitZip)) {
    return {
      locationType: 'zip', zip: explicitZip, city: explicitCity, state: explicitState,
      county: explicitCounty, locationText: explicitZip, needsReview: false,
    };
  }
  if (explicitCity || explicitCounty || explicitState) {
    const lt: LocationType = explicitCity ? 'city' : explicitCounty ? 'county' : 'state';
    return {
      locationType: lt, zip: null, city: explicitCity, state: explicitState,
      county: explicitCounty,
      locationText: [explicitCity, explicitState].filter(Boolean).join(', ') || explicitCounty || explicitState || '',
      needsReview: false,
    };
  }

  // 2) No free text and no explicit columns
  if (!freeText) {
    return { locationType: 'unknown', zip: null, city: null, state: null, county: null, locationText: '', needsReview: false };
  }

  // 3) ZIP free text
  if (isZip(freeText)) {
    return { locationType: 'zip', zip: freeText.slice(0, 5), city: null, state: null, county: null, locationText: freeText.slice(0, 5), needsReview: false };
  }

  // 4) "City, ST" or "City ST"
  const commaParts = freeText.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    const sc = stateCode(commaParts[1]);
    if (sc) return { locationType: 'city', zip: null, city: commaParts[0], state: sc, county: null, locationText: `${commaParts[0]}, ${sc}`, needsReview: false };
  }
  const wsTokens = freeText.split(/\s+/);
  if (wsTokens.length >= 2) {
    const last = wsTokens[wsTokens.length - 1];
    const sc = stateCode(last);
    if (sc) {
      const city = wsTokens.slice(0, -1).join(' ');
      return { locationType: 'city', zip: null, city, state: sc, county: null, locationText: `${city}, ${sc}`, needsReview: false };
    }
  }

  // 5) Whole text is a state name/code
  const wholeState = stateCode(freeText);
  if (wholeState) {
    return { locationType: 'state', zip: null, city: null, state: wholeState, county: null, locationText: US_STATES[wholeState], needsReview: false };
  }

  // 6) "national" / "nationwide"
  if (/^(national|nationwide|usa|us|united states)$/i.test(freeText)) {
    return { locationType: 'national', zip: null, city: null, state: null, county: null, locationText: 'National', needsReview: false };
  }

  // 7) Cannot confidently parse -> needs review. Keep the text as the city guess.
  return { locationType: 'unknown', zip: null, city: freeText, state: null, county: null, locationText: freeText, needsReview: true };
}

// ── Field normalization helpers ────────────────────────────────────
function normPriority(v?: string): string {
  const p = sanitizeText(v).toLowerCase();
  return VALID_PRIORITIES.has(p) ? p : 'medium';
}
function normMarket(v?: string): string {
  const m = sanitizeText(v).toLowerCase();
  return VALID_MARKET.has(m) ? m : 'unknown';
}

// ── Top-level parse (pure) ─────────────────────────────────────────
export function parseKeywordFile(content: string, fileName: string): ParseResult {
  const fileType = detectFileType(fileName, content.slice(0, 2000));
  if (!fileType) {
    return { fileType: 'csv', rows: [], totalRows: 0, validRows: 0, fatalError: 'Unsupported file type. Upload a CSV, TSV, or TXT file.' };
  }

  let records: RawRecord[];
  try {
    records = matrixToRecords(toMatrix(content, fileType));
  } catch (e: any) {
    return { fileType, rows: [], totalRows: 0, validRows: 0, fatalError: `Could not parse file: ${e?.message || 'parse failure'}` };
  }

  if (records.length === 0) {
    return { fileType, rows: [], totalRows: 0, validRows: 0, fatalError: 'No data rows found in file.' };
  }
  if (records.length > MAX_ROWS) {
    return {
      fileType, rows: [], totalRows: records.length, validRows: 0,
      fatalError: `File contains ${records.length} rows. Maximum is ${MAX_ROWS} rows per upload.`,
    };
  }

  const seen = new Set<string>(); // in-file dedup key keyword|location
  const rows: ParsedRow[] = [];
  records.forEach((rec, idx) => {
    const rawKeyword = sanitizeText(rec.keyword);
    const rawLocation = sanitizeText(rec.location);
    const loc = parseLocation(rec);
    const parsedKeyword = rawKeyword;
    const normalizedKeyword = normalizeKeywordLocal(parsedKeyword);

    let status: RowStatus = 'ready';
    let error: string | null = null;

    const hasLocation = !!(loc.zip || loc.city || loc.county || loc.state || loc.locationType === 'national');

    if (!parsedKeyword) {
      status = 'invalid';
      error = 'Missing keyword';
    } else if (!hasLocation && !loc.needsReview) {
      status = 'invalid';
      error = 'Missing location';
    } else if (loc.needsReview) {
      status = 'needs_review';
      error = 'Location could not be confidently parsed — review before import';
    }

    // In-file duplicate detection (only for otherwise-valid rows)
    if (status === 'ready' || status === 'needs_review') {
      const dupKey = `${normalizedKeyword}|${(loc.zip || `${loc.city || ''},${loc.state || ''}` || loc.locationType).toLowerCase()}`;
      if (seen.has(dupKey)) {
        status = 'duplicate';
        error = 'Duplicate of another row in this file';
      } else {
        seen.add(dupKey);
      }
    }

    rows.push({
      rowNumber: idx + 1,
      rawKeyword,
      rawLocation,
      keyword: escapeFormulaInjection(parsedKeyword),
      parsedKeyword,
      normalizedKeyword,
      locationText: loc.locationText,
      locationType: loc.locationType,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      county: loc.county,
      priority: normPriority(rec.priority),
      serviceLine: sanitizeText(rec.serviceLine) || null,
      marketOrientation: normMarket(rec.marketOrientation),
      intent: sanitizeText(rec.intent) || null,
      status,
      error,
    });
  });

  const validRows = rows.filter((r) => r.status === 'ready' || r.status === 'needs_review' || r.status === 'duplicate').length;
  return { fileType, rows, totalRows: records.length, validRows, fatalError: null };
}

// ── ZIP enrichment (async, injectable resolver) ────────────────────
export type ZipResolver = (zip: string) => Promise<{ city: string | null; state: string | null; county: string | null } | null>;

/**
 * Resolve city/state/county for any ZIP rows that are missing them. Mutates and
 * returns the rows. If the resolver returns null (ZIP unknown) the row keeps
 * zip + locationType=zip with city/state blank (per spec).
 */
export async function enrichRowsWithZip(rows: ParsedRow[], resolver: ZipResolver): Promise<ParsedRow[]> {
  for (const row of rows) {
    if (row.zip && (!row.city || !row.state)) {
      try {
        const d = await resolver(row.zip);
        if (d) {
          row.city = row.city || d.city;
          row.state = row.state || d.state;
          row.county = row.county || d.county;
        }
      } catch {
        // leave as-is; zip stays stored
      }
    }
  }
  return rows;
}
