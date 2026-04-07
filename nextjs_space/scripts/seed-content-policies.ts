/**
 * Seed Content Policies for the RSS Intelligence System.
 *
 * Run with:
 *   cd nextjs_space && npx tsx scripts/seed-content-policies.ts
 *
 * Uses upsert to avoid duplicates on re-run. Never deletes existing records.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POLICIES = [
  // ═══ HARD BLOCK — zero tolerance ═══
  {
    category: 'sexual_adult',
    action: 'hard_block',
    label: 'Sexual / Adult Content',
    description:
      'Blocks all sexually explicit content, adult entertainment, escort services, pornography, and NSFW material. Medical/anatomical articles with clinical context may be false positives — route to manual_review via LLM classifier.',
    keywords: [
      'porn', 'pornography', 'xxx', 'nsfw', 'onlyfans',
      'escort service', 'strip club', 'adult entertainment',
      'sexually explicit', 'sex tape', 'erotic',
    ],
  },
  {
    category: 'political_opinion',
    action: 'hard_block',
    label: 'Political Opinion / Partisan Content',
    description:
      'Blocks partisan political opinion, editorials advocating for candidates/parties, campaign endorsements, and divisive political commentary. ALLOWS factual local government news (city council minutes, mayor announcements, ballot measure factual coverage).',
    keywords: [
      'op-ed', 'editorial', 'opinion column', 'my take on',
      'vote for', 'vote against', 'endorse', 'endorsement',
      'election fraud', 'stolen election', 'rigged election',
      'far-right', 'far-left', 'anti-woke',
    ],
  },

  // ═══ SOFT FILTER — routes to manual_review ═══
  {
    category: 'violence_graphic',
    action: 'soft_filter',
    label: 'Graphic Violence',
    description:
      'Flags content with graphic violence descriptions. Standard crime reporting ("robbery at Main St") is typically safe; graphic details ("graphic photos of victim") should be reviewed.',
    keywords: [
      'mass shooting', 'massacre', 'graphic content warning',
      'disturbing images', 'execution video',
    ],
  },
  {
    category: 'drug_alcohol',
    action: 'soft_filter',
    label: 'Drug / Alcohol Promotion',
    description:
      'Flags content promoting drug use or heavy alcohol consumption. Wine/craft beer festival announcements are typically safe; "get drunk" promotions are not.',
    keywords: [
      'drug deal', 'meth lab', 'cocaine', 'heroin',
      'binge drinking', 'alcohol promotion',
    ],
  },
  {
    category: 'gambling',
    action: 'soft_filter',
    label: 'Gambling / Betting',
    description:
      'Flags gambling promotions, sports betting, and casino content. Charity poker tournaments may be false positives.',
    keywords: [
      'sports betting', 'online casino', 'slot machine',
      'betting odds', 'point spread',
    ],
  },
  {
    category: 'religious_divisive',
    action: 'soft_filter',
    label: 'Divisive Religious Content',
    description:
      'Flags religiously divisive or proselytizing content. Church community events, holiday services, and charity drives are typically safe.',
    keywords: [
      'sinners', 'infidel', 'heretic', 'cult',
      'religious war', 'holy war',
    ],
  },
  {
    category: 'legal_controversy',
    action: 'soft_filter',
    label: 'Legal Controversy / Lawsuits',
    description:
      'Flags major legal controversies and defamation-risk content. Standard court reporting is typically safe.',
    keywords: [
      'class action', 'sex scandal', 'fraud charges',
      'corruption indictment',
    ],
  },
  {
    category: 'disaster_tragedy',
    action: 'soft_filter',
    label: 'Disaster / Tragedy',
    description:
      'Flags major disasters and tragedies. Weather warnings and safety info are safe; graphic aftermath descriptions should be reviewed.',
    keywords: [
      'mass casualty', 'death toll', 'bodies found',
      'devastating loss',
    ],
  },

  // ═══ ALLOW — explicitly safe categories ═══
  {
    category: 'local_event',
    action: 'allow',
    label: 'Local Event / Festival',
    description: 'Community events, festivals, parades, farmers markets, fundraisers. Always safe for social posting.',
    keywords: [],
  },
  {
    category: 'community_news',
    action: 'allow',
    label: 'Community News',
    description: 'General community news, business openings, ribbon cuttings, neighborhood updates.',
    keywords: [],
  },
  {
    category: 'business_spotlight',
    action: 'allow',
    label: 'Business Spotlight',
    description: 'Local business features, new store openings, business awards, employee spotlights.',
    keywords: [],
  },
  {
    category: 'weather',
    action: 'allow',
    label: 'Weather Update',
    description: 'Weather forecasts, road conditions, school closures due to weather.',
    keywords: [],
  },
  {
    category: 'sports',
    action: 'allow',
    label: 'Local Sports',
    description: 'High school sports, local leagues, community recreation. Safe for social posting.',
    keywords: [],
  },
  {
    category: 'education',
    action: 'allow',
    label: 'Education / Schools',
    description: 'School events, board meetings (factual), graduation, academic achievements.',
    keywords: [],
  },
  {
    category: 'health_wellness',
    action: 'allow',
    label: 'Health & Wellness',
    description: 'Community health events, wellness tips, blood drives, vaccination clinics.',
    keywords: [],
  },
  {
    category: 'gov_factual',
    action: 'allow',
    label: 'Factual Government News',
    description: 'City council agendas, public meeting notices, infrastructure projects, park openings. Must be factual, not opinion.',
    keywords: [],
  },
  {
    category: 'real_estate',
    action: 'allow',
    label: 'Real Estate / Housing',
    description: 'Housing market updates, new development announcements, community zoning info.',
    keywords: [],
  },
  {
    category: 'food_dining',
    action: 'allow',
    label: 'Food & Dining',
    description: 'Restaurant reviews, food festivals, new menu announcements, local dining guides.',
    keywords: [],
  },
  {
    category: 'arts_culture',
    action: 'allow',
    label: 'Arts & Culture',
    description: 'Art shows, museum events, theater performances, cultural festivals.',
    keywords: [],
  },
];

async function main() {
  console.log('Seeding content policies...');

  for (const policy of POLICIES) {
    const result = await prisma.contentPolicy.upsert({
      where: { category: policy.category },
      update: {
        action: policy.action,
        label: policy.label,
        description: policy.description,
        keywords: policy.keywords,
        isActive: true,
      },
      create: {
        category: policy.category,
        action: policy.action,
        label: policy.label,
        description: policy.description,
        keywords: policy.keywords,
        isActive: true,
      },
    });
    const icon = policy.action === 'hard_block' ? '🔴' : policy.action === 'soft_filter' ? '🟡' : '🟢';
    console.log(`  ${icon} ${policy.category} → ${policy.action} (${result.id})`);
  }

  const count = await prisma.contentPolicy.count();
  console.log(`\n✅ Done. ${count} content policies in database.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
