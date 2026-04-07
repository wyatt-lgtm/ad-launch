/**
 * Phase 4: Content Deduplication Engine
 *
 * Two-tier dedup strategy:
 *
 *   Tier 1 — Exact GUID dedup (per-feed)
 *     The @@unique([feedId, guid]) constraint in Prisma handles this.
 *
 *   Tier 2 — Cross-feed near-duplicate detection
 *     Uses SimHash (locality-sensitive hashing) on normalized title+description.
 *     Two items with SimHash hamming distance ≤ 3 bits (out of 64) are
 *     considered duplicates.
 *
 * SimHash implementation:
 *   - Tokenize text into bigrams
 *   - Hash each bigram with FNV-1a → 64-bit
 *   - Aggregate weighted +1/-1 per bit → final 64-bit fingerprint
 *   - Store as hex string (16 chars) in contentHash field
 *
 * Node.js crypto is used only for the text normalization.
 * The hashing itself is pure FNV-1a (no crypto dependency in hot path).
 */

// ═══════════════════════════════════════════════════════════════
// SimHash
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a 64-bit SimHash fingerprint of the given text.
 * Returns a 16-char hex string.
 */
export function simhash(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length < 5) return '0000000000000000';

  const bigrams = toBigrams(normalized);
  // 64-element array to accumulate weighted bits
  const v = new Float64Array(64);

  for (const bigram of bigrams) {
    const h = fnv1a64(bigram);
    for (let i = 0; i < 64; i++) {
      // Check bit i of h
      // h is a BigInt — check each bit
      if ((h >> BigInt(i)) & 1n) {
        v[i] += 1;
      } else {
        v[i] -= 1;
      }
    }
  }

  // Build final 64-bit hash
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) {
      hash |= (1n << BigInt(i));
    }
  }

  return hash.toString(16).padStart(16, '0');
}

/**
 * Compute the Hamming distance between two SimHash hex strings.
 * Returns the number of differing bits (0–64).
 */
export function hammingDistance(a: string, b: string): number {
  const ha = BigInt('0x' + a);
  const hb = BigInt('0x' + b);
  let xor = ha ^ hb;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

/**
 * Are two content hashes near-duplicates?
 * Threshold: ≤ 3 bits difference out of 64.
 */
export function isNearDuplicate(hashA: string, hashB: string, threshold = 3): boolean {
  if (!hashA || !hashB || hashA === '0000000000000000' || hashB === '0000000000000000') return false;
  return hammingDistance(hashA, hashB) <= threshold;
}

/**
 * Generate a contentHash for an RSS item from its title + description.
 */
export function itemContentHash(title: string | null, description: string | null): string {
  const text = [title ?? '', description ?? ''].join(' ');
  return simhash(text);
}

// ═══════════════════════════════════════════════════════════════
// Text Normalization
// ═══════════════════════════════════════════════════════════════

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')      // strip HTML
    .replace(/[^a-z0-9\s]/g, ' ')  // only alphanumeric + space
    .replace(/\s+/g, ' ')
    .trim();
}

function toBigrams(text: string): string[] {
  const words = text.split(' ').filter(w => w.length > 0);
  if (words.length < 2) return words;
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + ' ' + words[i + 1]);
  }
  return bigrams;
}

// ═══════════════════════════════════════════════════════════════
// FNV-1a 64-bit (pure JS BigInt)
// ═══════════════════════════════════════════════════════════════

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = (1n << 64n) - 1n;

function fnv1a64(str: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}
