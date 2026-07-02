/**
 * Milestone 10 — URL normalization for backlink preservation.
 *
 * Pure, dependency-free, network-free. Produces a canonical path used to match
 * an old (existing-site) URL against a newly proposed sitemap page, and to
 * de-duplicate inventoried URLs. Normalization intentionally:
 *   - lowercases the host + path,
 *   - strips the scheme, default ports, trailing slash (except root),
 *   - drops common tracking query params + all fragments,
 *   - collapses duplicate slashes,
 *   - strips a trailing index.html / index.php / default.aspx.
 */

const TRACKING_PARAM_PREFIXES = ['utm_', 'fbclid', 'gclid', 'mc_', 'ref', 'ref_', '_ga'];
const DEFAULT_DOCS = new Set(['index.html', 'index.htm', 'index.php', 'default.aspx', 'default.asp']);

export interface NormalizedUrl {
  /** Canonical path (always begins with '/'), query-stripped, no fragment. */
  path: string;
  /** Lowercased host without port, or null when input had no host. */
  host: string | null;
  /** The original input, trimmed. */
  raw: string;
}

function stripDefaultDoc(path: string): string {
  const segs = path.split('/');
  const last = segs[segs.length - 1];
  if (last && DEFAULT_DOCS.has(last.toLowerCase())) {
    segs.pop();
    const joined = segs.join('/');
    return joined.length ? joined : '/';
  }
  return path;
}

function cleanPath(rawPath: string): string {
  let p = (rawPath || '').trim();
  if (!p) return '/';
  // Drop fragment + query defensively (callers usually pass path only).
  const hash = p.indexOf('#');
  if (hash !== -1) p = p.slice(0, hash);
  const q = p.indexOf('?');
  if (q !== -1) p = p.slice(0, q);
  if (!p.startsWith('/')) p = '/' + p;
  // Collapse duplicate slashes.
  p = p.replace(/\/{2,}/g, '/');
  // Lowercase (paths on the customer's marketing sites are case-insensitive in
  // practice; consistent casing is required for stable matching).
  p = p.toLowerCase();
  p = stripDefaultDoc(p);
  // Strip trailing slash except for root.
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  return p.length ? p : '/';
}

/** Parse a URL or bare path into a normalized form. Never throws. */
export function normalizeUrl(input: string): NormalizedUrl {
  const raw = (input || '').trim();
  if (!raw) return { path: '/', host: null, raw };

  let host: string | null = null;
  let pathPart = raw;
  let search = '';

  // Try to parse as an absolute URL first.
  const looksAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^\/\//.test(raw);
  try {
    const u = new URL(looksAbsolute ? raw : `https://placeholder.invalid${raw.startsWith('/') ? '' : '/'}${raw}`);
    host = looksAbsolute ? u.hostname.toLowerCase() : null;
    pathPart = u.pathname;
    search = u.search;
  } catch {
    // Fall back to treating the whole string as a path.
    pathPart = raw;
    search = '';
  }

  const path = cleanPath(pathPart + (keepQuery(search) ? search : ''));
  return { path, host, raw };
}

/** We currently drop ALL query strings for matching (tracking + otherwise). */
function keepQuery(_search: string): boolean {
  return false;
}

/** Convenience: just the normalized path. */
export function normalizePath(input: string): string {
  return normalizeUrl(input).path;
}

/** True when a query param name is a well-known tracking parameter. */
export function isTrackingParam(name: string): boolean {
  const n = (name || '').toLowerCase();
  return TRACKING_PARAM_PREFIXES.some((p) => n === p || n.startsWith(p));
}

/** Tokenize a normalized path into meaningful lowercased word tokens. */
export function pathTokens(path: string): string[] {
  return (path || '')
    .toLowerCase()
    .split(/[\/\-_.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

const STOP_TOKENS = new Set([
  'the', 'and', 'for', 'our', 'your', 'services', 'service', 'page', 'html', 'htm', 'php',
  'index', 'home', 'www', 'com', 'net', 'org', 'near', 'me', 'in', 'of', 'to', 'a', 'an',
]);
