/**
 * Interview Data — all questions, helpers, examples, document mappings, quality scoring.
 * Source of truth for the "Help Me Build It" business profile interview.
 */

// ── Question definition ──────────────────────────────────────────────────────

export interface InterviewQuestion {
  key: string;
  label: string;
  helper: string;
  example: string;
  /** If true, this question is in the Quick Start set */
  quickStart?: boolean;
  /** Privacy default for this question's answer */
  defaultPrivacy: 'public' | 'ai_reference_only' | 'private_internal' | 'do_not_use';
  /** If true, this is considered a sensitive question */
  sensitive?: boolean;
}

export interface InterviewSection {
  id: string;
  title: string;
  description: string;
  questions: InterviewQuestion[];
  /** Document types this section feeds */
  feedsDocuments: string[];
  /** Quality score weight (out of 100) */
  qualityWeight: number;
}

// ── Privacy levels ───────────────────────────────────────────────────────────

export const PRIVACY_LEVELS = [
  { value: 'public', label: 'Public', description: 'Can be used in any customer-facing content', icon: '🌐' },
  { value: 'ai_reference_only', label: 'AI Reference Only', description: 'AI agents can use for context but content is not published directly', icon: '🤖' },
  { value: 'private_internal', label: 'Private / Internal', description: 'Internal reference only — never used in any content', icon: '🔒' },
  { value: 'do_not_use', label: 'Do Not Use', description: 'Explicitly excluded from all use', icon: '🚫' },
] as const;

export type PrivacyLevel = typeof PRIVACY_LEVELS[number]['value'];

// ── Section status ───────────────────────────────────────────────────────────

export type SectionStatus = 'not_started' | 'in_progress' | 'good_enough' | 'strong' | 'needs_review';

export const SECTION_STATUS_CONFIG: Record<SectionStatus, { label: string; color: string; bgColor: string }> = {
  not_started: { label: 'Not Started', color: 'text-gray-400', bgColor: 'bg-gray-100' },
  in_progress: { label: 'In Progress', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  good_enough: { label: 'Good Enough', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  strong: { label: 'Strong', color: 'text-green-600', bgColor: 'bg-green-50' },
  needs_review: { label: 'Needs Review', color: 'text-orange-600', bgColor: 'bg-orange-50' },
};

export function getSectionStatus(section: InterviewSection, answers: Record<string, string>): SectionStatus {
  const total = section.questions.length;
  const answered = section.questions.filter(q => (answers[q.key] || '').trim().length > 0).length;
  if (answered === 0) return 'not_started';
  const ratio = answered / total;
  if (ratio < 0.4) return 'in_progress';
  // Check answer quality — short answers count less
  const detailedCount = section.questions.filter(q => {
    const a = (answers[q.key] || '').trim();
    return a.length > 30;
  }).length;
  const detailedRatio = detailedCount / total;
  if (ratio >= 0.8 && detailedRatio >= 0.5) return 'strong';
  if (ratio >= 0.5) return 'good_enough';
  return 'in_progress';
}

// ── Document types ───────────────────────────────────────────────────────────

export interface DocumentType {
  type: string;
  title: string;
  prompt: string;
  /** Which interview sections feed this document */
  sourceSections: string[];
  /** Default privacy for generated document */
  defaultPrivacy: PrivacyLevel;
}

export const DOCUMENT_TYPES: DocumentType[] = [
  {
    type: 'owner_bio',
    title: 'Owner Bio',
    prompt: 'Write a professional owner/founder bio',
    sourceSections: ['founder'],
    defaultPrivacy: 'public',
  },
  {
    type: 'founder_story',
    title: 'Founder Story',
    prompt: 'Write a compelling founder story narrative that shows the journey, motivation, and vision behind starting this business',
    sourceSections: ['founder', 'history', 'mission'],
    defaultPrivacy: 'public',
  },
  {
    type: 'company_history',
    title: 'Company History',
    prompt: 'Write a company history document covering founding, milestones, growth, and key moments',
    sourceSections: ['history', 'basics'],
    defaultPrivacy: 'public',
  },
  {
    type: 'mission_statement',
    title: 'Mission Statement',
    prompt: 'Write a clear, inspiring mission statement',
    sourceSections: ['mission'],
    defaultPrivacy: 'public',
  },
  {
    type: 'company_profile',
    title: 'Company Profile',
    prompt: 'Write a comprehensive company profile suitable for website About sections and business listings',
    sourceSections: ['basics', 'founder', 'history', 'mission', 'services'],
    defaultPrivacy: 'public',
  },
  {
    type: 'service_area',
    title: 'Service Area Description',
    prompt: 'Write a service area description optimized for local SEO, mentioning cities, neighborhoods, and regional terms',
    sourceSections: ['serviceArea'],
    defaultPrivacy: 'public',
  },
  {
    type: 'customer_profile',
    title: 'Ideal Customer Profile',
    prompt: 'Write a detailed ideal customer profile describing who the business serves best, their needs, and buying triggers',
    sourceSections: ['services'],
    defaultPrivacy: 'ai_reference_only',
  },
  {
    type: 'differentiators',
    title: 'Differentiators / Why Choose Us',
    prompt: 'Write a compelling "Why Choose Us" section highlighting competitive advantages with proof points',
    sourceSections: ['differentiators', 'credentials'],
    defaultPrivacy: 'public',
  },
  {
    type: 'credentials',
    title: 'Credentials, Awards & Guarantees',
    prompt: 'Summarize all credentials, certifications, awards, ratings, guarantees, and trust signals with any required disclaimers',
    sourceSections: ['credentials'],
    defaultPrivacy: 'public',
  },
  {
    type: 'faq_source',
    title: 'FAQ Source Document',
    prompt: 'Create a comprehensive FAQ document from customer questions, formatted as Q&A pairs',
    sourceSections: ['questions'],
    defaultPrivacy: 'public',
  },
  {
    type: 'objections_guide',
    title: 'Customer Objections & Response Guide',
    prompt: 'Create an objections and response guide covering price, trust, timing, and competitor objections with recommended responses',
    sourceSections: ['objections'],
    defaultPrivacy: 'ai_reference_only',
  },
  {
    type: 'brand_voice',
    title: 'Brand Voice Guide',
    prompt: 'Write a brand voice and tone guide with examples of preferred language, words to use, words to avoid, and tone guidelines',
    sourceSections: ['voice'],
    defaultPrivacy: 'ai_reference_only',
  },
  {
    type: 'claims_avoid',
    title: 'Words / Claims to Avoid',
    prompt: 'List all words, claims, phrases, and promises that should be avoided, with reasons and any required disclaimers',
    sourceSections: ['compliance'],
    defaultPrivacy: 'ai_reference_only',
  },
  {
    type: 'master_profile',
    title: 'Full Business Profile Master Document',
    prompt: 'Create a comprehensive master business profile document combining all sections into one reference document',
    sourceSections: ['basics', 'founder', 'history', 'mission', 'services', 'serviceArea', 'differentiators', 'credentials', 'questions', 'objections', 'voice', 'compliance'],
    defaultPrivacy: 'ai_reference_only',
  },
];

// ── Section-level generation buttons ─────────────────────────────────────────

export const SECTION_GENERATE_BUTTONS: Record<string, { label: string; docTypes: string[] }> = {
  basics: { label: 'Generate Company Profile', docTypes: ['company_profile'] },
  founder: { label: 'Generate Owner Bio & Founder Story', docTypes: ['owner_bio', 'founder_story'] },
  history: { label: 'Generate Company History', docTypes: ['company_history'] },
  mission: { label: 'Generate Mission Statement', docTypes: ['mission_statement'] },
  services: { label: 'Generate Customer Profile', docTypes: ['customer_profile'] },
  serviceArea: { label: 'Generate Service Area Description', docTypes: ['service_area'] },
  differentiators: { label: 'Generate Why Choose Us', docTypes: ['differentiators'] },
  credentials: { label: 'Generate Credentials & Guarantees', docTypes: ['credentials'] },
  questions: { label: 'Generate FAQ Source', docTypes: ['faq_source'] },
  objections: { label: 'Generate Objection Response Guide', docTypes: ['objections_guide'] },
  voice: { label: 'Generate Brand Voice Guide', docTypes: ['brand_voice'] },
  compliance: { label: 'Generate Claims to Avoid', docTypes: ['claims_avoid'] },
};

// ── Interview sections with full question data ───────────────────────────────

export const INTERVIEW_SECTIONS: InterviewSection[] = [
  {
    id: 'basics',
    title: 'Business Basics',
    description: 'Core information about the business — name, location, services, and contact details.',
    qualityWeight: 15,
    feedsDocuments: ['company_profile', 'service_area', 'master_profile'],
    questions: [
      {
        key: 'officialName',
        label: 'What is the official business name?',
        helper: 'The exact legal or DBA name you want used in marketing.',
        example: 'Thompson Plumbing & Drain Service, LLC',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'namesAbbreviations',
        label: 'What names, nicknames, or abbreviations should we use or avoid?',
        helper: 'Preferred short names, nicknames customers use, or variations to avoid.',
        example: 'Use "Thompson Plumbing" or "Thompson\'s" — avoid "TP&D" or "Thompson LLC"',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'oneSentence',
        label: 'What does the business do in one sentence?',
        helper: 'A clear one-liner someone could repeat to a friend.',
        example: 'We provide same-day plumbing repair and drain cleaning for homes and small businesses in the Dallas–Fort Worth area.',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'mainServices',
        label: 'What are the main services or products?',
        helper: 'List the primary things you sell or do, in order of importance.',
        example: 'Emergency plumbing repair, drain cleaning, water heater installation, bathroom remodeling, sewer line repair',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'yearsOperating',
        label: 'How long has the business been operating?',
        helper: 'Years in business, or the year it was founded.',
        example: 'Founded in 2008 — 18 years in business',
        defaultPrivacy: 'public',
      },
      {
        key: 'location',
        label: 'Where is the business located?',
        helper: 'Physical address, city, or general area. Include multiple locations if applicable.',
        example: '4521 Oak Lawn Ave, Dallas, TX 75219 — with a second crew based in Fort Worth',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'ownerLeader',
        label: 'Who owns or leads the business?',
        helper: 'Name and title of the owner, founder, or primary leader.',
        example: 'Mike Thompson, Owner & Master Plumber',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'contactInfo',
        label: 'What is the main phone number, website, and public contact information?',
        helper: 'Phone, website, email, and any other public contact details.',
        example: '(214) 555-1234 | thompsonplumbing.com | service@thompsonplumbing.com',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'founder',
    title: 'Owner / Founder Story',
    description: 'The personal story behind the business — background, motivation, and credibility.',
    qualityWeight: 10,
    feedsDocuments: ['owner_bio', 'founder_story', 'master_profile'],
    questions: [
      {
        key: 'founderName',
        label: 'Who is the owner or founder?',
        helper: 'Full name and any relevant titles or credentials.',
        example: 'Mike Thompson — licensed Master Plumber, EPA-certified',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'founderBackground',
        label: 'What is their background?',
        helper: 'Education, career history, or life experience that led to this business.',
        example: 'Started as a plumber\'s apprentice at 18, worked for commercial contractors for 12 years, earned Master Plumber license in 2006',
        defaultPrivacy: 'public',
      },
      {
        key: 'whyStarted',
        label: 'Why did they start or join this business?',
        helper: 'The personal motivation or turning point that led to starting the business.',
        example: 'Got tired of seeing big companies overcharge homeowners for simple repairs. Wanted to build an honest local shop.',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'problemSolving',
        label: 'What problem were they trying to solve?',
        helper: 'The gap in the market or frustration they saw.',
        example: 'Homeowners didn\'t trust plumbers because of hidden fees and unnecessary upsells.',
        defaultPrivacy: 'public',
      },
      {
        key: 'credibility',
        label: 'What experience, training, or personal story makes them credible?',
        helper: 'Credentials, years of experience, notable projects, or personal qualities.',
        example: '30+ years hands-on experience, trained under two master plumbers, completed 10,000+ service calls',
        defaultPrivacy: 'public',
      },
      {
        key: 'values',
        label: 'What values do they want customers to associate with the business?',
        helper: 'The core values that guide how you treat customers.',
        example: 'Honesty, fair pricing, showing up on time, fixing it right the first time',
        defaultPrivacy: 'public',
      },
      {
        key: 'bioTone',
        label: 'What should the owner bio sound like? (professional, friendly, local, premium, etc.)',
        helper: 'The tone and style for the owner\'s public biography.',
        example: 'Friendly and down-to-earth — like a neighbor who happens to be an expert plumber',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'excludeDetails',
        label: 'Are there personal details that should not be included publicly?',
        helper: 'Any personal information to keep private — family, age, address, etc.',
        example: 'Don\'t mention family members by name. Don\'t include home address.',
        sensitive: true,
        defaultPrivacy: 'private_internal',
      },
    ],
  },
  {
    id: 'history',
    title: 'Company History',
    description: 'The story of the business over time — founding, growth, and key milestones.',
    qualityWeight: 5,
    feedsDocuments: ['company_history', 'company_profile', 'master_profile'],
    questions: [
      {
        key: 'whenStarted',
        label: 'When was the company started?',
        helper: 'Year founded and any relevant context about how it started.',
        example: 'January 2008 — started from a garage with one van and $5,000 in tools',
        defaultPrivacy: 'public',
      },
      {
        key: 'whyStartedCompany',
        label: 'Why was it started?',
        helper: 'The founding story — what motivated the creation of this business.',
        example: 'After getting laid off from a corporate plumbing company, decided to start own shop focused on residential customers',
        defaultPrivacy: 'public',
      },
      {
        key: 'milestones',
        label: 'What major milestones should be included?',
        helper: 'Growth achievements, team expansions, awards, service additions.',
        example: '2010: Hired first employee. 2015: Expanded to Fort Worth. 2020: Reached 5,000 five-star reviews. 2023: Added bathroom remodeling.',
        defaultPrivacy: 'public',
      },
      {
        key: 'changes',
        label: 'Has the business changed names, locations, or services over time?',
        helper: 'Any rebranding, relocations, or major shifts in what you offer.',
        example: 'Originally "Mike\'s Plumbing" — rebranded to "Thompson Plumbing & Drain Service" in 2012 when we incorporated',
        defaultPrivacy: 'public',
      },
      {
        key: 'proudOf',
        label: 'What is the company most proud of?',
        helper: 'The achievement, reputation, or impact that matters most.',
        example: 'We\'ve maintained a 4.9-star rating over 15 years with zero BBB complaints',
        defaultPrivacy: 'public',
      },
      {
        key: 'storyDifferent',
        label: "What makes the company's story different from competitors?",
        helper: 'The unique element of your journey that competitors can\'t replicate.',
        example: 'We\'re the only local plumber where every technician is a licensed master plumber, not just an apprentice',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'mission',
    title: 'Mission & Purpose',
    description: 'Why the business exists, the promise to customers, and what drives the team.',
    qualityWeight: 5,
    feedsDocuments: ['mission_statement', 'company_profile', 'master_profile'],
    questions: [
      {
        key: 'whyExists',
        label: 'Why does this business exist beyond making money?',
        helper: 'The deeper purpose or contribution the business makes.',
        example: 'Every homeowner deserves a plumber they can trust — someone who tells the truth about what\'s wrong and charges a fair price',
        defaultPrivacy: 'public',
      },
      {
        key: 'problemSolved',
        label: 'What problem does it solve for customers?',
        helper: 'The core customer problem your business addresses.',
        example: 'Plumbing emergencies are stressful. We make it easy — fast response, upfront pricing, no surprises.',
        defaultPrivacy: 'public',
      },
      {
        key: 'customerDeserve',
        label: 'What does the business believe customers deserve?',
        helper: 'The standard of service you hold yourself to.',
        example: 'Customers deserve honest diagnosis, fair pricing, and a clean house when we leave',
        defaultPrivacy: 'public',
      },
      {
        key: 'missionPlain',
        label: 'What is the mission statement in plain language?',
        helper: 'A simple, jargon-free statement anyone can understand.',
        example: 'Fix it right, price it fair, treat every home like our own.',
        defaultPrivacy: 'public',
      },
      {
        key: 'brandPromise',
        label: 'What promise should customers feel from the brand?',
        helper: 'The emotional takeaway — how customers should feel when interacting with your brand.',
        example: 'You can relax — we\'ve got this handled.',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'services',
    title: 'Services & Customers',
    description: 'What you sell, who you serve, and who benefits most from your work.',
    qualityWeight: 15,
    feedsDocuments: ['customer_profile', 'company_profile', 'master_profile'],
    questions: [
      {
        key: 'coreServices',
        label: 'What are the core services or products?',
        helper: 'List each service or product line with brief descriptions.',
        example: 'Emergency plumbing repair (24/7), drain cleaning & camera inspection, water heater install/repair, bathroom remodeling, sewer line replacement',
        defaultPrivacy: 'public',
      },
      {
        key: 'mostProfitable',
        label: 'Which services are most profitable?',
        helper: 'The services that generate the best margins or highest revenue.',
        example: 'Bathroom remodeling and water heater installations have the best margins. Emergency calls have the highest volume.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'promoteOften',
        label: 'Which services should Launch OS promote most often?',
        helper: 'The services you want more of — high-margin, underbooked, or strategic.',
        example: 'Push bathroom remodeling and drain cleaning. These are our growth areas.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'avoidServices',
        label: 'Which services should be avoided or de-emphasized?',
        helper: 'Services that are low-margin, being phased out, or overbooked.',
        example: 'Don\'t promote basic faucet installs — too low margin. We\'re phasing out commercial work.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'idealCustomer',
        label: 'Who is the ideal customer?',
        helper: 'Demographics, location, income level, property type, or behavior patterns.',
        example: 'Homeowners in Dallas–Fort Worth suburbs, homes 15+ years old, household income $75K+, who value quality over cheapest price',
        quickStart: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'notGoodFit',
        label: 'Who is not a good fit?',
        helper: 'Customer types that cause problems, disputes, or aren\'t profitable.',
        example: 'Landlords looking for cheapest possible fix. Customers who demand work without permits. Commercial/industrial projects.',
        sensitive: true,
        defaultPrivacy: 'private_internal',
      },
      {
        key: 'customerTypes',
        label: 'Are customers residential, commercial, local, national, high-income, budget-conscious, urgent-need, recurring, etc.?',
        helper: 'Describe your customer mix and segments.',
        example: '90% residential, 10% small commercial. Mostly local homeowners, mix of urgent repairs and planned remodels.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'triggerToCall',
        label: 'What customer problems usually trigger someone to call?',
        helper: 'The moment or situation that makes someone pick up the phone.',
        example: 'Burst pipe, backed-up drain, no hot water, visible water damage, buying/selling a home and need inspection',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'serviceArea',
    title: 'Service Area',
    description: 'Where the business operates — cities, regions, and local context.',
    qualityWeight: 10,
    feedsDocuments: ['service_area', 'company_profile', 'master_profile'],
    questions: [
      {
        key: 'areasServed',
        label: 'What cities, neighborhoods, counties, or regions does the business serve?',
        helper: 'List all areas you actively serve or want to target.',
        example: 'Dallas, Fort Worth, Arlington, Plano, Frisco, McKinney, Allen, Richardson, Garland — all of DFW metroplex within 30 miles of downtown Dallas',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'priorityMarkets',
        label: 'Are there priority markets?',
        helper: 'Areas where you want more business or have a competitive advantage.',
        example: 'Highland Park, University Park, and Lakewood — these neighborhoods have older homes that need more plumbing work',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'areasNotServed',
        label: 'Are there areas the business does not serve?',
        helper: 'Areas outside your range or that you want to exclude.',
        example: 'We don\'t go south of Waxahachie or east of Rockwall. Too far for efficient service.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'serviceModel',
        label: 'Does the business have a storefront, service radius, mobile area, or multiple locations?',
        helper: 'How customers physically interact with your business.',
        example: 'No storefront — we come to you. Two dispatch locations: main office in Dallas, satellite crew in Fort Worth.',
        defaultPrivacy: 'public',
      },
      {
        key: 'localTerms',
        label: 'Are there local landmarks, communities, or regional terms customers recognize?',
        helper: 'Neighborhood names, landmarks, or local terms that resonate with your audience.',
        example: 'People say "the Metroplex" not "DFW metro area." Highland Park is different from Dallas proper. "Lake Highlands" and "White Rock" are recognized neighborhoods.',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'differentiators',
    title: 'Differentiators',
    description: 'What makes the business stand out from competitors.',
    qualityWeight: 15,
    feedsDocuments: ['differentiators', 'company_profile', 'master_profile'],
    questions: [
      {
        key: 'whyChoose',
        label: 'Why should a customer choose this business instead of a competitor?',
        helper: 'Mention speed, trust, price, quality, experience, convenience, warranty, local reputation, specialty knowledge, or customer service.',
        example: 'Customers choose us because we explain repairs clearly, do not pressure people into unnecessary work, and have over 20 years of experience with domestic and import vehicles.',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'whatBetter',
        label: 'What does the business do better?',
        helper: 'Specific things you outperform competitors on.',
        example: 'Faster response times — we guarantee same-day service. Our plumbers are all Master-licensed, not apprentices.',
        defaultPrivacy: 'public',
      },
      {
        key: 'proof',
        label: 'What proof supports those claims?',
        helper: 'Reviews, awards, data, customer testimonials, or verifiable facts.',
        example: '4.9 stars on Google (800+ reviews), A+ BBB rating, "Best Plumber" award from D Magazine 3 years running',
        defaultPrivacy: 'public',
      },
      {
        key: 'competitorWeakness',
        label: 'What are competitors bad at that this business avoids?',
        helper: 'Common complaints about competitors that you don\'t have.',
        example: 'Competitors send untrained techs, show up late, and surprise customers with hidden fees. We don\'t.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'neverClaim',
        label: 'What should never be claimed if it is not true?',
        helper: 'Claims or statements that would be false, misleading, or unverifiable.',
        example: 'Don\'t say "lowest prices in Dallas" — we\'re not cheapest. Don\'t say "guaranteed same-day" for remodeling projects.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
    ],
  },
  {
    id: 'credentials',
    title: 'Credentials & Guarantees',
    description: 'Licenses, certifications, awards, and guarantees that build trust.',
    qualityWeight: 5,
    feedsDocuments: ['credentials', 'differentiators', 'master_profile'],
    questions: [
      {
        key: 'licenses',
        label: 'What licenses, certifications, memberships, or credentials should be mentioned?',
        helper: 'Professional licenses, industry certifications, trade association memberships.',
        example: 'Texas Master Plumber License #M-41234, EPA Lead-Safe Certified, member of Plumbing-Heating-Cooling Contractors Association',
        defaultPrivacy: 'public',
      },
      {
        key: 'awardsRatings',
        label: 'Are there awards, years in business, review counts, or ratings that can be used?',
        helper: 'Verifiable trust signals — make sure they are current and accurate.',
        example: 'D Magazine "Best Plumber" 2022, 2023, 2024. 800+ Google reviews with 4.9 average. 16 years in business.',
        defaultPrivacy: 'public',
      },
      {
        key: 'guarantees',
        label: 'Are there warranties, guarantees, trial offers, or satisfaction policies?',
        helper: 'What do you guarantee, and under what conditions?',
        example: '1-year labor warranty on all repairs. Lifetime warranty on water heater installations. Satisfaction guarantee — we come back free if anything goes wrong.',
        defaultPrivacy: 'public',
      },
      {
        key: 'disclaimers',
        label: 'Are there conditions or disclaimers tied to those guarantees?',
        helper: 'Fine print, exclusions, or conditions that must accompany guarantee claims.',
        example: 'Labor warranty does not cover damage caused by customer modifications. Lifetime warranty is on the unit only, not labor.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'legalReview',
        label: 'Are there claims that require legal review before publishing?',
        helper: 'Claims that could have legal implications if stated incorrectly.',
        example: 'Any claims about being "the best" or "guaranteed results" should be reviewed. Insurance-related claims need legal sign-off.',
        sensitive: true,
        defaultPrivacy: 'private_internal',
      },
    ],
  },
  {
    id: 'questions',
    title: 'Customer Questions',
    description: 'The questions customers ask most — before, during, and after buying.',
    qualityWeight: 7,
    feedsDocuments: ['faq_source', 'master_profile'],
    questions: [
      {
        key: 'preBuyQuestions',
        label: 'What questions do customers ask before buying?',
        helper: 'Pre-purchase questions — pricing, process, timeline, availability.',
        example: 'How much does it cost? How fast can you get here? Do you offer financing? Are you licensed and insured?',
        quickStart: true,
        defaultPrivacy: 'public',
      },
      {
        key: 'postBuyQuestions',
        label: 'What questions do customers ask after buying?',
        helper: 'Post-service questions — warranties, maintenance, follow-up.',
        example: 'What\'s covered under warranty? How do I maintain my new water heater? When should I schedule a follow-up?',
        defaultPrivacy: 'public',
      },
      {
        key: 'comparisonQuestions',
        label: 'What questions do customers ask when comparing competitors?',
        helper: 'The questions people ask when shopping around.',
        example: 'Why are you more expensive than XYZ Plumbing? Do you offer free estimates? What makes you different?',
        defaultPrivacy: 'public',
      },
      {
        key: 'salesTeamExplains',
        label: 'What does the sales team explain over and over?',
        helper: 'Repeated explanations that could be handled by content.',
        example: 'We explain the difference between repair and replacement costs, why we don\'t do "free" estimates (our diagnostic is thorough), and our warranty terms',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'faqCandidates',
        label: 'What questions should be turned into website FAQs, social posts, or explainer videos?',
        helper: 'High-value questions worth creating content around.',
        example: '"How do I know if I need a new water heater?" "What causes slow drains?" "How often should I have my sewer line inspected?"',
        defaultPrivacy: 'public',
      },
    ],
  },
  {
    id: 'objections',
    title: 'Customer Objections',
    description: 'Why customers hesitate and how to address their concerns.',
    qualityWeight: 8,
    feedsDocuments: ['objections_guide', 'master_profile'],
    questions: [
      {
        key: 'hesitateWhy',
        label: 'Why do customers hesitate?',
        helper: 'The main reasons people don\'t buy right away.',
        example: 'They want to get multiple quotes, they\'re not sure if they need the repair yet, they\'re worried about the cost',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'priceObjections',
        label: 'What price objections come up?',
        helper: 'Price-related pushback and what drives it.',
        example: '"Your competitor quoted $200 less" — usually because they use cheaper parts or skip permit requirements',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'trustObjections',
        label: 'What trust objections come up?',
        helper: 'Trust-related concerns — are you reliable, honest, qualified?',
        example: '"How do I know you won\'t upsell me?" — we show customers the problem on camera before recommending a fix',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'timingObjections',
        label: 'What timing objections come up?',
        helper: 'Timing-related pushback — not now, not urgent, bad timing.',
        example: '"I\'ll deal with it next month" — for drain issues, waiting often makes it 3x more expensive',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'competitorComparisons',
        label: 'What competitor comparisons come up?',
        helper: 'How customers compare you to specific competitors.',
        example: '"ABC Plumbing is cheaper" — they send apprentices, not master plumbers. "Big Box Home Services" — they subcontract to whoever is available',
        sensitive: true,
        defaultPrivacy: 'private_internal',
      },
      {
        key: 'howToAnswer',
        label: 'How should the business answer those objections?',
        helper: 'Approved response approaches for common objections.',
        example: 'Price: explain the value difference. Trust: offer camera inspection. Timing: explain cost of waiting.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'dontArgue',
        label: 'What objections should not be argued with directly?',
        helper: 'Objections where the best approach is to acknowledge and move on.',
        example: 'Don\'t argue about price with extreme budget shoppers. Don\'t badmouth competitors by name in public content.',
        sensitive: true,
        defaultPrivacy: 'private_internal',
      },
    ],
  },
  {
    id: 'voice',
    title: 'Brand Voice',
    description: 'How the business should sound across all content — tone, style, and language.',
    qualityWeight: 10,
    feedsDocuments: ['brand_voice', 'master_profile'],
    questions: [
      {
        key: 'soundLike',
        label: 'What should the business sound like?',
        helper: 'Describe the personality — if the business were a person, how would they talk?',
        example: 'Friendly neighbor who knows plumbing inside out. Approachable but clearly expert. No corporate jargon.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'useOften',
        label: 'What words or phrases should Launch OS use often?',
        helper: 'Brand phrases, talking points, or terms that reinforce your positioning.',
        example: '"Fix it right the first time," "honest pricing," "your neighborhood plumber," "same-day service"',
        quickStart: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'avoidWords',
        label: 'What words or phrases should Launch OS avoid?',
        helper: 'Terms that conflict with your brand, are inaccurate, or turn off your audience.',
        example: 'Don\'t say "cheap" — say "affordable" or "fair pricing." Don\'t use "disrupting the industry" or corporate buzzwords.',
        quickStart: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'tone',
        label: 'Should the tone be professional, casual, technical, local, premium, warm, direct, etc.?',
        helper: 'Pick 2-3 tone qualities that best describe how content should feel.',
        example: 'Warm, direct, and local. Professional but not stuffy. Talk like a trusted neighbor, not a corporation.',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'industryTermsKnown',
        label: 'Are there industry terms customers understand?',
        helper: 'Technical terms your audience actually knows and uses.',
        example: 'Customers know: "water heater," "garbage disposal," "sump pump," "drain snake"',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'industryTermsUnknown',
        label: 'Are there industry terms customers do NOT understand?',
        helper: 'Technical jargon to avoid or always explain.',
        example: 'Don\'t use: "hydrojetting" (say "high-pressure drain cleaning"), "backflow preventer" (say "valve that keeps dirty water out")',
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'pronouns',
        label: 'Should copy say "I," "we," "our team," or the business name?',
        helper: 'The perspective used in marketing copy.',
        example: 'Use "we" and "our team" — never "I" unless it\'s a quote from Mike directly. Use "Thompson Plumbing" on first mention, then "we" after.',
        defaultPrivacy: 'ai_reference_only',
      },
    ],
  },
  {
    id: 'compliance',
    title: 'Claims & Compliance',
    description: 'Legal constraints, regulated claims, and content that requires review.',
    qualityWeight: 5,
    feedsDocuments: ['claims_avoid', 'master_profile'],
    questions: [
      {
        key: 'regulatedClaims',
        label: 'Are there regulated claims, legal disclaimers, financing disclosures, or medical/legal/financial restrictions?',
        helper: 'Industry regulations, required disclosures, or legal constraints on advertising.',
        example: 'Financing offers must include APR disclosure. Cannot claim "emergency" unless we have 24/7 dispatch. EPA lead-safe disclosure required for pre-1978 homes.',
        quickStart: true,
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'cannotPromise',
        label: 'Are there things the business cannot legally promise?',
        helper: 'Promises or outcomes that would be false, misleading, or legally risky.',
        example: 'Cannot promise specific timeframes for remodeling. Cannot guarantee insurance will cover a specific repair.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'competitorClaimsAvoid',
        label: 'Are there claims competitors make that this business should avoid?',
        helper: 'Competitor marketing tactics that are misleading or risky for your business to copy.',
        example: 'Competitors say "free estimate" but charge a diagnostic fee. We should not copy that — just be upfront about our $49 diagnostic.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'testimonialRules',
        label: 'Are there before/after, customer result, or testimonial rules?',
        helper: 'Rules around using customer stories, results, or before/after imagery.',
        example: 'Always get written permission for before/after photos. Never use customer names without consent. Results may vary disclaimer on remodeling photos.',
        sensitive: true,
        defaultPrivacy: 'ai_reference_only',
      },
      {
        key: 'manualReview',
        label: 'Should any generated content require manual review before publishing?',
        helper: 'Types of content that should always be reviewed by a human before going live.',
        example: 'All content mentioning pricing, guarantees, or legal claims should be reviewed. Social posts can go out without review.',
        defaultPrivacy: 'ai_reference_only',
      },
    ],
  },
];

// ── Quick Start questions (extracted from sections) ──────────────────────────

export const QUICK_START_QUESTIONS = INTERVIEW_SECTIONS.flatMap(s =>
  s.questions.filter(q => q.quickStart).map(q => ({ ...q, sectionId: s.id, sectionTitle: s.title }))
);

// ── Quality scoring ──────────────────────────────────────────────────────────

export interface QualityScore {
  total: number;
  breakdown: { sectionId: string; sectionTitle: string; score: number; maxScore: number; missing: string[] }[];
  improvements: string[];
}

export function calculateQualityScore(
  answers: Record<string, Record<string, string>>,
): QualityScore {
  const breakdown: QualityScore['breakdown'] = [];
  const improvements: string[] = [];

  for (const section of INTERVIEW_SECTIONS) {
    const sectionAnswers = answers[section.id] || {};
    const total = section.questions.length;
    const answered = section.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;
    const detailed = section.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 30).length;

    // Score based on coverage + detail
    const coverageRatio = answered / total;
    const detailBonus = detailed / total * 0.3;
    const sectionScore = Math.round(section.qualityWeight * Math.min(1, coverageRatio + detailBonus));

    const missing: string[] = [];
    section.questions.forEach(q => {
      const a = (sectionAnswers[q.key] || '').trim();
      if (!a) missing.push(q.label);
      else if (a.length < 15) missing.push(`Add more detail: ${q.label}`);
    });

    breakdown.push({
      sectionId: section.id,
      sectionTitle: section.title,
      score: sectionScore,
      maxScore: section.qualityWeight,
      missing,
    });

    // Generate improvement suggestions
    if (coverageRatio < 0.3) {
      improvements.push(`Complete the ${section.title} section`);
    } else if (coverageRatio < 0.7) {
      const unanswered = section.questions.filter(q => !(sectionAnswers[q.key] || '').trim()).length;
      improvements.push(`Answer ${unanswered} more questions in ${section.title}`);
    }
  }

  return {
    total: breakdown.reduce((sum, b) => sum + b.score, 0),
    breakdown,
    improvements,
  };
}

// ── Document feeds mapping (section → what it generates) ─────────────────────

export const SECTION_FEEDS: Record<string, string[]> = {
  basics: ['Company Profile', 'Website About section', 'Business listing descriptions', 'SEO homepage copy'],
  founder: ['Owner Bio', 'Founder Story', 'Founder Story video script', 'Social introduction posts'],
  history: ['Company History', 'About page', 'Local trust content'],
  mission: ['Mission Statement', 'Brand promise', 'Website hero messaging', 'Social brand posts'],
  services: ['Service pages', 'Ideal customer profile', 'Ad targeting notes', 'SEO content plan'],
  serviceArea: ['Service area page', 'Local SEO content', 'Google Business Profile content', 'Community Engagement location context'],
  differentiators: ['Why Choose Us', 'Ads', 'Landing pages', 'Sales scripts'],
  credentials: ['Trust badges', 'Website proof sections', 'Offers and disclaimers', 'Compliance notes'],
  questions: ['FAQ page', 'Social explainer posts', 'Community Engagement replies', 'Video script ideas'],
  objections: ['Objection response guide', 'Sales copy', 'Email follow-up', 'FAQ content'],
  voice: ['Brand Voice Guide', 'Social tone', 'Website copy style', 'AI writing instructions'],
  compliance: ['Words / Claims to Avoid', 'Required disclaimers', 'Compliance restrictions', 'Manual review flags'],
};
