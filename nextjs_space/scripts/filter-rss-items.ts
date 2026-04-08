/**
 * Phase 6A: Content Filter Batch Sweep
 *
 * Runs every RssItem with filterStatus='pending' through the content policy engine,
 * updates filterStatus/filterReason/blockedCategory, and creates ItemAudit rows.
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/filter-rss-items.ts           # all pending
 *   cd nextjs_space && npx tsx scripts/filter-rss-items.ts --all     # re-run on ALL items
 *   cd nextjs_space && npx tsx scripts/filter-rss-items.ts --dry-run # preview only
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Inline the keyword engine (can't import from lib/ which uses @/ alias) ──
// We replicate the policy engine logic here to avoid path alias issues in scripts.
// This is a direct copy from lib/rss/content-policy.ts

const SEXUAL_ADULT_KEYWORDS: RegExp[] = [
  /\b(porn|pornograph|xxx|nsfw|onlyfans|sex\s?tape|erotic|hentai)\b/i,
  /\b(escort\s?service|strip\s?club|adult\s?entertainment|nude|nudity)\b/i,
  /\b(sexually\s+explicit|sex\s?worker|prostitut|brothel)\b/i,
  /\b(fetish|bdsm|orgasm|genitalia)\b/i,
];

const POLITICAL_OPINION_KEYWORDS: RegExp[] = [
  /\b(op-?ed|editorial|opinion|letter\s+to\s+(the\s+)?editor|my\s+take|commentary)\b/i,
  /\b(republican|democrat|gop|dnc|rnc|maga|liberal|conservative)\b.*\b(should|must|need\s+to|wrong|right|fail|destroy)\b/i,
  /\b(vote\s+for|vote\s+against|endorse|endorsement|ballot\s+measure)\b/i,
  /\b(campaign\s+trail|election\s+fraud|stolen\s+election|rigged)\b/i,
  /\b(far[- ]right|far[- ]left|woke|anti[- ]woke)\b/i,
  /\b(defund\s+(the\s+)?police|gun\s+control|second\s+amendment\s+rights|pro[- ]life|pro[- ]choice)\b.*\b(should|must|need)\b/i,
];

const POLITICAL_CONTEXT_TERMS = /\b(republican|democrat|gop|liberal|conservative|trump|biden|congress)\b/i;
const OPINION_INDICATORS = /\b(should|must|wrong|terrible|destroy|radical|extreme|outrageous|shame|disgrace)\b/i;

const VIOLENCE_KEYWORDS: RegExp[] = [
  /\b(mass\s+shoot|gunman|massacre|beheading|execution|graphic\s+content)\b/i,
  /\b(murder|homicide|stabbing|assault\s+with)\b.*\b(graphic|disturbing|warning)\b/i,
];

const DRUG_ALCOHOL_KEYWORDS: RegExp[] = [
  /\b(marijuana\s+dispensary|cannabis\s+shop|drug\s+deal|meth\s+lab|cocaine|heroin)\b/i,
  /\b(binge\s+drink|alcohol\s+promotion|get\s+drunk|beer\s+pong\s+tournament)\b/i,
];

const GAMBLING_KEYWORDS: RegExp[] = [
  /\b(sports\s?bet|online\s+casino|gambling|poker\s+tournament|slot\s+machine)\b/i,
  /\b(betting\s+odds|point\s+spread|parlay|wager)\b/i,
];

const SAFE_LOCAL_INDICATORS: RegExp[] = [
  /\b(ribbon\s+cutting|grand\s+opening|community\s+event|farmers\s+market)\b/i,
  /\b(city\s+council\s+meeting|school\s+board|town\s+hall|public\s+hearing)\b/i,
  /\b(local\s+business|small\s+business|chamber\s+of\s+commerce)\b/i,
  /\b(festival|parade|fundraiser|charity|volunteer|donation\s+drive)\b/i,
  /\b(weather\s+forecast|road\s+closure|traffic\s+update|school\s+closure)\b/i,
  /\b(new\s+restaurant|store\s+opening|business\s+spotlight|employee\s+of)\b/i,
  /\b(high\s+school\s+football|little\s+league|local\s+sports|homecoming)\b/i,
  /\b(library\s+event|book\s+club|storytime|summer\s+reading)\b/i,
  /\b(parks?\s+(and\s+)?rec|hiking\s+trail|playground|community\s+center)\b/i,
];

interface FilterDecision {
  status: 'approved' | 'blocked' | 'manual_review' | 'pending';
  category: string | null;
  confidence: number;
  reason: string;
  method: string;
}

type DBPolicy = {
  category: string;
  action: string;
  keywords: string[];
  isActive: boolean;
};

function classifyContent(
  title: string | null,
  description: string | null,
  feedStatus?: string,
  dbPolicies?: DBPolicy[],
): FilterDecision {
  const text = `${title ?? ''} ${description ?? ''}`.trim();

  if (feedStatus === 'blocked') {
    return { status: 'blocked', category: null, confidence: 1.0, reason: 'Feed is blocked at source level', method: 'source_block' };
  }
  if (!text) {
    return { status: 'manual_review', category: null, confidence: 0, reason: 'No title or description to classify', method: 'keyword' };
  }

  // Hard block: sexual/adult
  for (const p of SEXUAL_ADULT_KEYWORDS) {
    if (p.test(text)) return { status: 'blocked', category: 'sexual_adult', confidence: 0.95, reason: `Matched: ${p.source.slice(0, 60)}`, method: 'keyword' };
  }
  const sexPolicy = dbPolicies?.find(p => p.category === 'sexual_adult');
  if (sexPolicy?.keywords?.length) {
    for (const kw of sexPolicy.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) return { status: 'blocked', category: 'sexual_adult', confidence: 0.90, reason: `DB keyword: "${kw}"`, method: 'keyword' };
    }
  }

  // Hard block: political/opinion
  for (const p of POLITICAL_OPINION_KEYWORDS) {
    if (p.test(text)) return { status: 'blocked', category: 'political_opinion', confidence: 0.90, reason: `Matched: ${p.source.slice(0, 60)}`, method: 'keyword' };
  }
  if (POLITICAL_CONTEXT_TERMS.test(text) && OPINION_INDICATORS.test(text)) {
    return { status: 'blocked', category: 'political_opinion', confidence: 0.80, reason: 'Political context + opinion indicator', method: 'keyword' };
  }
  const polPolicy = dbPolicies?.find(p => p.category === 'political_opinion');
  if (polPolicy?.keywords?.length) {
    for (const kw of polPolicy.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) return { status: 'blocked', category: 'political_opinion', confidence: 0.85, reason: `DB keyword: "${kw}"`, method: 'keyword' };
    }
  }

  // Soft filter: violence
  for (const p of VIOLENCE_KEYWORDS) {
    if (p.test(text)) return { status: 'manual_review', category: 'violence_graphic', confidence: 0.70, reason: `Violence: ${p.source.slice(0, 60)}`, method: 'keyword' };
  }
  // Soft filter: drugs/alcohol
  for (const p of DRUG_ALCOHOL_KEYWORDS) {
    if (p.test(text)) return { status: 'manual_review', category: 'drug_alcohol', confidence: 0.70, reason: `Drug/alcohol: ${p.source.slice(0, 60)}`, method: 'keyword' };
  }
  // Soft filter: gambling
  for (const p of GAMBLING_KEYWORDS) {
    if (p.test(text)) return { status: 'manual_review', category: 'gambling', confidence: 0.70, reason: `Gambling: ${p.source.slice(0, 60)}`, method: 'keyword' };
  }

  // DB soft-filter policies
  if (dbPolicies?.length) {
    for (const policy of dbPolicies) {
      if (policy.action !== 'soft_filter' || !policy.keywords?.length) continue;
      if (policy.category === 'sexual_adult' || policy.category === 'political_opinion') continue;
      for (const kw of policy.keywords) {
        if (text.toLowerCase().includes(kw.toLowerCase())) {
          return { status: 'manual_review', category: policy.category, confidence: 0.65, reason: `DB soft-filter: "${kw}"`, method: 'keyword' };
        }
      }
    }
  }

  // Safe local indicators → auto-approve
  let safeMatches = 0;
  for (const p of SAFE_LOCAL_INDICATORS) {
    if (p.test(text)) safeMatches++;
  }
  if (safeMatches >= 1) {
    return { status: 'approved', category: 'community_news', confidence: 0.75 + Math.min(safeMatches * 0.05, 0.20), reason: `${safeMatches} safe indicator(s)`, method: 'keyword' };
  }

  // Default: auto-approve with low confidence
  return { status: 'approved', category: null, confidence: 0.50, reason: 'No keyword matches — auto-approved', method: 'auto_allow' };
}

// ── Main ────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 200;

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');

  console.log(`\n📋 Phase 6A: Content Filter Batch Sweep`);
  console.log(`   Mode: ${runAll ? 'ALL items' : 'pending only'}${dryRun ? ' (DRY RUN)' : ''}`);

  // Load DB policies
  const policies = await prisma.contentPolicy.findMany({ where: { isActive: true } });
  console.log(`   Loaded ${policies.length} active content policies\n`);

  // Count items to process
  const where = runAll ? {} : { filterStatus: 'pending' };
  const totalCount = await prisma.rssItem.count({ where });
  console.log(`   Items to process: ${totalCount}\n`);

  if (totalCount === 0) {
    console.log('   ✅ Nothing to filter — all items already processed.');
    return;
  }

  let processed = 0;
  let approved = 0;
  let blocked = 0;
  let review = 0;
  const blockedCategories: Record<string, number> = {};

  // Process in batches
  let cursor: string | undefined;
  while (processed < totalCount) {
    const items = await prisma.rssItem.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        feed: { select: { status: true, sourceType: true } },
      },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    if (items.length === 0) break;

    for (const item of items) {
      const decision = classifyContent(
        item.title,
        item.description,
        item.feed.status,
        policies,
      );

      if (!dryRun) {
        // Update item
        await prisma.rssItem.update({
          where: { id: item.id },
          data: {
            filterStatus: decision.status,
            filterReason: decision.reason,
            blockedCategory: decision.category,
          },
        });

        // Create audit trail
        await prisma.itemAudit.create({
          data: {
            itemId: item.id,
            action: decision.status === 'blocked' ? 'auto_blocked' : decision.status === 'approved' ? 'auto_approved' : 'auto_blocked',
            category: decision.category,
            confidence: decision.confidence,
            reason: decision.reason,
            performedBy: 'system:content_filter_v1',
          },
        });
      }

      if (decision.status === 'approved') approved++;
      else if (decision.status === 'blocked') {
        blocked++;
        const cat = decision.category ?? 'uncategorized';
        blockedCategories[cat] = (blockedCategories[cat] ?? 0) + 1;
      }
      else review++;

      processed++;
    }

    cursor = items[items.length - 1].id;
    if (processed % 500 === 0 || processed === totalCount) {
      console.log(`   ▸ Progress: ${processed}/${totalCount} (${Math.round(processed/totalCount*100)}%)`);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Content Filter Summary${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`   Processed:       ${processed}`);
  console.log(`   ✅ Approved:      ${approved} (${(approved/processed*100).toFixed(1)}%)`);
  console.log(`   🚫 Blocked:       ${blocked} (${(blocked/processed*100).toFixed(1)}%)`);
  console.log(`   ⚠️  Manual Review: ${review} (${(review/processed*100).toFixed(1)}%)`);
  if (Object.keys(blockedCategories).length > 0) {
    console.log(`\n   Blocked by category:`);
    for (const [cat, count] of Object.entries(blockedCategories).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${cat.padEnd(25)} ${count}`);
    }
  }
  console.log(`${'═'.repeat(60)}\n`);
}

main()
  .catch(e => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
