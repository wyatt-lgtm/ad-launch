import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('johndoe123', 10);
  await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      password: hashedPassword,
      confirmed: true,
      freeAdsUsed: 0,
    },
  });
  console.log('User seed completed');

  // === Content Policies (RSS Intelligence System) ===
  const policies = [
    { category: 'sexual_adult', action: 'hard_block', label: 'Sexual / Adult Content', description: 'Blocks all sexually explicit content, adult entertainment, escort services, pornography, and NSFW material.', keywords: ['porn','pornography','xxx','nsfw','onlyfans','escort service','strip club','adult entertainment','sexually explicit','sex tape','erotic'] },
    { category: 'political_opinion', action: 'hard_block', label: 'Political Opinion / Partisan Content', description: 'Blocks partisan political opinion, editorials advocating for candidates/parties, campaign endorsements.', keywords: ['op-ed','editorial','opinion column','my take on','vote for','vote against','endorse','endorsement','election fraud','stolen election','rigged election','far-right','far-left','anti-woke'] },
    { category: 'violence_graphic', action: 'soft_filter', label: 'Graphic Violence', description: 'Flags content with graphic violence descriptions for manual review.', keywords: ['mass shooting','massacre','graphic content warning','disturbing images','execution video'] },
    { category: 'drug_alcohol', action: 'soft_filter', label: 'Drug / Alcohol Promotion', description: 'Flags content promoting drug use or heavy alcohol consumption.', keywords: ['drug deal','meth lab','cocaine','heroin','binge drinking','alcohol promotion'] },
    { category: 'gambling', action: 'soft_filter', label: 'Gambling / Betting', description: 'Flags gambling promotions, sports betting, and casino content.', keywords: ['sports betting','online casino','slot machine','betting odds','point spread'] },
    { category: 'religious_divisive', action: 'soft_filter', label: 'Divisive Religious Content', description: 'Flags religiously divisive or proselytizing content.', keywords: ['sinners','infidel','heretic','cult','religious war','holy war'] },
    { category: 'legal_controversy', action: 'soft_filter', label: 'Legal Controversy / Lawsuits', description: 'Flags major legal controversies and defamation-risk content.', keywords: ['class action','sex scandal','fraud charges','corruption indictment'] },
    { category: 'disaster_tragedy', action: 'soft_filter', label: 'Disaster / Tragedy', description: 'Flags major disasters and tragedies for manual review.', keywords: ['mass casualty','death toll','bodies found','devastating loss'] },
    { category: 'local_event', action: 'allow', label: 'Local Event / Festival', description: 'Community events, festivals, parades, farmers markets.', keywords: [] },
    { category: 'community_news', action: 'allow', label: 'Community News', description: 'General community news, business openings, neighborhood updates.', keywords: [] },
    { category: 'business_spotlight', action: 'allow', label: 'Business Spotlight', description: 'Local business features, new store openings, business awards.', keywords: [] },
    { category: 'weather', action: 'allow', label: 'Weather Update', description: 'Weather forecasts, road conditions, school closures.', keywords: [] },
    { category: 'sports', action: 'allow', label: 'Local Sports', description: 'High school sports, local leagues, community recreation.', keywords: [] },
    { category: 'education', action: 'allow', label: 'Education / Schools', description: 'School events, board meetings, graduation, academic achievements.', keywords: [] },
    { category: 'health_wellness', action: 'allow', label: 'Health & Wellness', description: 'Community health events, wellness tips, blood drives.', keywords: [] },
    { category: 'gov_factual', action: 'allow', label: 'Factual Government News', description: 'City council agendas, public meeting notices, infrastructure projects.', keywords: [] },
    { category: 'real_estate', action: 'allow', label: 'Real Estate / Housing', description: 'Housing market updates, new development announcements.', keywords: [] },
    { category: 'food_dining', action: 'allow', label: 'Food & Dining', description: 'Restaurant reviews, food festivals, local dining guides.', keywords: [] },
    { category: 'arts_culture', action: 'allow', label: 'Arts & Culture', description: 'Art shows, museum events, theater performances, cultural festivals.', keywords: [] },
  ];

  for (const p of policies) {
    await prisma.contentPolicy.upsert({
      where: { category: p.category },
      update: { action: p.action, label: p.label, description: p.description, keywords: p.keywords, isActive: true },
      create: { category: p.category, action: p.action, label: p.label, description: p.description, keywords: p.keywords, isActive: true },
    });
  }
  console.log(`Content policies seeded: ${policies.length} policies`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
