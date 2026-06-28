/**
 * Idempotent seed for the Industry Service Taxonomy.
 *
 * Safe to re-run: uses upsert on stable slugs. Never deletes.
 * Run with:  yarn tsx --require dotenv/config scripts/seed-industries.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type ServiceSeed = {
  name: string;
  shortDescription?: string;
  customerProblem?: string;
  commonQuestions?: string[];
  commonObjections?: string[];
  relatedServices?: string[];
  matchKeywords?: string[];
  conditional?: boolean;
  schemaType?: string;
};

type IndustrySeed = {
  name: string;
  description: string;
  matchKeywords: string[];
  gbpCategories: string[];
  services: ServiceSeed[];
};

// ── Industry catalog (extensible without schema changes) ────────────────────
const INDUSTRIES: IndustrySeed[] = [
  {
    name: 'Auto Repair',
    description: 'Automotive repair and maintenance shops servicing cars, trucks, and fleets.',
    matchKeywords: ['auto repair', 'mechanic', 'car repair', 'automotive', 'auto service', 'brake', 'oil change', 'transmission', 'tire shop', 'muffler', 'auto shop', 'vehicle repair', 'engine repair'],
    gbpCategories: ['Auto repair shop', 'Auto mechanic', 'Car repair and maintenance service', 'Brake shop', 'Tire shop', 'Transmission shop'],
    services: [
      { name: 'Brake Repair', matchKeywords: ['brake', 'brakes', 'brake pad', 'brake repair', 'rotor'], customerProblem: 'Squealing, grinding, or longer stopping distances signal worn brakes that put drivers at risk.', shortDescription: 'Brake inspection, pad and rotor replacement, and full brake system service.' },
      { name: 'Oil Change', matchKeywords: ['oil change', 'oil', 'lube', 'synthetic oil'], customerProblem: 'Dirty or low oil leads to engine wear and costly breakdowns.', shortDescription: 'Conventional and synthetic oil changes with filter replacement.' },
      { name: 'Check Engine Light Diagnostics', matchKeywords: ['check engine', 'engine light', 'obd', 'diagnostic'], customerProblem: 'A check engine light leaves drivers unsure whether the issue is minor or serious.', shortDescription: 'Computerized scan and diagnosis of check engine light codes.' },
      { name: 'Engine Diagnostics', matchKeywords: ['engine diagnostic', 'engine diagnostics', 'engine problem'], shortDescription: 'Comprehensive engine performance diagnostics.' },
      { name: 'Battery Replacement', matchKeywords: ['battery', 'battery replacement', 'dead battery'], shortDescription: 'Battery testing and replacement.' },
      { name: 'Alternator Replacement', matchKeywords: ['alternator'], shortDescription: 'Alternator testing and replacement.' },
      { name: 'Starter Replacement', matchKeywords: ['starter', 'starter motor'], shortDescription: 'Starter motor diagnosis and replacement.' },
      { name: 'AC Repair', matchKeywords: ['ac repair', 'air conditioning', 'a/c', 'auto ac'], shortDescription: 'Automotive air conditioning diagnosis and repair.' },
      { name: 'Heating System Repair', matchKeywords: ['heater', 'heating', 'heater core'], shortDescription: 'Vehicle heating system repair.' },
      { name: 'Suspension Repair', matchKeywords: ['suspension', 'shocks', 'struts'], shortDescription: 'Shocks, struts, and suspension component repair.' },
      { name: 'Steering Repair', matchKeywords: ['steering', 'power steering', 'rack and pinion'], shortDescription: 'Steering system diagnosis and repair.' },
      { name: 'Wheel Alignment', matchKeywords: ['alignment', 'wheel alignment'], shortDescription: 'Precision wheel alignment service.' },
      { name: 'Tire Rotation', matchKeywords: ['tire rotation', 'rotate tires'], shortDescription: 'Tire rotation for even wear.' },
      { name: 'Tire Replacement', matchKeywords: ['tire replacement', 'new tires', 'tire sales'], shortDescription: 'Tire sales and installation.' },
      { name: 'Transmission Service', matchKeywords: ['transmission service', 'transmission flush'], shortDescription: 'Transmission fluid service and maintenance.' },
      { name: 'Transmission Repair', matchKeywords: ['transmission repair', 'transmission rebuild'], shortDescription: 'Transmission diagnosis, repair, and rebuilds.' },
      { name: 'Radiator Repair', matchKeywords: ['radiator'], shortDescription: 'Radiator repair and replacement.' },
      { name: 'Coolant Flush', matchKeywords: ['coolant', 'coolant flush', 'antifreeze'], shortDescription: 'Coolant system flush and refill.' },
      { name: 'Water Pump Replacement', matchKeywords: ['water pump'], shortDescription: 'Water pump replacement.' },
      { name: 'Timing Belt Replacement', matchKeywords: ['timing belt'], shortDescription: 'Timing belt inspection and replacement.' },
      { name: 'Serpentine Belt Replacement', matchKeywords: ['serpentine belt', 'drive belt'], shortDescription: 'Serpentine belt replacement.' },
      { name: 'Spark Plug Replacement', matchKeywords: ['spark plug', 'spark plugs', 'tune up'], shortDescription: 'Spark plug replacement and tune-ups.' },
      { name: 'Fuel System Service', matchKeywords: ['fuel system', 'fuel injection', 'fuel pump'], shortDescription: 'Fuel system cleaning and repair.' },
      { name: 'Exhaust System Repair', matchKeywords: ['exhaust', 'muffler', 'catalytic converter'], shortDescription: 'Exhaust and muffler repair.' },
      { name: 'Emissions Repair', matchKeywords: ['emissions', 'emission', 'smog'], shortDescription: 'Emissions testing and repair.' },
      { name: 'Pre-Purchase Inspection', matchKeywords: ['pre-purchase inspection', 'used car inspection', 'ppi'], shortDescription: 'Thorough inspection before buying a used vehicle.' },
      { name: 'Preventive Maintenance', matchKeywords: ['preventive maintenance', 'scheduled maintenance', 'maintenance'], shortDescription: 'Scheduled and preventive vehicle maintenance.' },
      { name: 'Fleet Maintenance', matchKeywords: ['fleet', 'fleet maintenance', 'fleet service'], shortDescription: 'Maintenance programs for business fleets.' },
      { name: 'Diesel Repair', matchKeywords: ['diesel', 'diesel repair'], conditional: true, shortDescription: 'Diesel engine repair and service.' },
      { name: 'Hybrid Vehicle Service', matchKeywords: ['hybrid', 'hybrid service', 'hybrid battery'], conditional: true, shortDescription: 'Hybrid vehicle maintenance and repair.' },
      { name: 'European Auto Repair', matchKeywords: ['european', 'bmw', 'mercedes', 'audi', 'volkswagen', 'european auto'], conditional: true, shortDescription: 'Specialized service for European vehicles.' },
      { name: 'Domestic Auto Repair', matchKeywords: ['domestic', 'ford', 'chevy', 'chevrolet', 'gm', 'dodge', 'domestic auto'], conditional: true, shortDescription: 'Service for domestic American vehicles.' },
      { name: 'Asian Import Auto Repair', matchKeywords: ['asian import', 'honda', 'toyota', 'nissan', 'subaru', 'import'], conditional: true, shortDescription: 'Service for Asian import vehicles.' },
    ],
  },
  {
    name: 'Dental',
    description: 'Dental practices offering general, cosmetic, and specialty dentistry.',
    matchKeywords: ['dentist', 'dental', 'dentistry', 'teeth', 'orthodontic', 'oral care', 'dental clinic', 'family dentistry'],
    gbpCategories: ['Dentist', 'Dental clinic', 'Cosmetic dentist', 'Pediatric dentist', 'Orthodontist'],
    services: [
      { name: 'Dental Cleaning', matchKeywords: ['cleaning', 'dental cleaning', 'prophylaxis', 'hygiene'], customerProblem: 'Plaque buildup and gum issues require regular professional cleaning.', shortDescription: 'Professional teeth cleaning and hygiene.' },
      { name: 'Dental Exam', matchKeywords: ['exam', 'dental exam', 'checkup', 'check-up'], shortDescription: 'Comprehensive dental examination.' },
      { name: 'Teeth Whitening', matchKeywords: ['whitening', 'teeth whitening', 'bleaching'], shortDescription: 'Professional teeth whitening.' },
      { name: 'Dental Crowns', matchKeywords: ['crown', 'crowns', 'dental crown'], shortDescription: 'Custom dental crowns.' },
      { name: 'Dental Bridges', matchKeywords: ['bridge', 'bridges', 'dental bridge'], shortDescription: 'Dental bridges to replace missing teeth.' },
      { name: 'Dental Implants', matchKeywords: ['implant', 'implants', 'dental implant'], shortDescription: 'Permanent dental implants.' },
      { name: 'Dentures', matchKeywords: ['denture', 'dentures', 'partial denture'], shortDescription: 'Full and partial dentures.' },
      { name: 'Root Canal', matchKeywords: ['root canal', 'endodontic'], shortDescription: 'Root canal therapy.' },
      { name: 'Tooth Extraction', matchKeywords: ['extraction', 'tooth extraction', 'wisdom teeth', 'pull tooth'], shortDescription: 'Simple and surgical tooth extractions.' },
      { name: 'Emergency Dentistry', matchKeywords: ['emergency', 'emergency dentist', 'emergency dental', 'dental emergency'], shortDescription: 'Urgent dental care for pain and trauma.' },
      { name: 'Invisalign / Clear Aligners', matchKeywords: ['invisalign', 'clear aligner', 'aligners', 'clear braces'], shortDescription: 'Clear aligner orthodontic treatment.' },
      { name: 'Cosmetic Dentistry', matchKeywords: ['cosmetic', 'cosmetic dentistry', 'veneers', 'smile makeover'], shortDescription: 'Cosmetic dental treatments.' },
      { name: 'Family Dentistry', matchKeywords: ['family dentistry', 'family dentist'], shortDescription: 'Comprehensive dental care for all ages.' },
      { name: 'Pediatric Dentistry', matchKeywords: ['pediatric', 'kids dentist', 'children dentist', 'pediatric dentistry'], conditional: true, shortDescription: 'Dental care for children.' },
    ],
  },
  {
    name: 'HVAC',
    description: 'Heating, ventilation, and air conditioning service and installation companies.',
    matchKeywords: ['hvac', 'heating', 'air conditioning', 'furnace', 'heat pump', 'ac repair', 'cooling', 'ventilation', 'ac installation'],
    gbpCategories: ['HVAC contractor', 'Air conditioning contractor', 'Heating contractor', 'Furnace repair service'],
    services: [
      { name: 'AC Repair', matchKeywords: ['ac repair', 'air conditioning repair', 'a/c repair'], customerProblem: 'A failing AC during peak heat leaves families uncomfortable and at risk.', shortDescription: 'Air conditioning diagnosis and repair.' },
      { name: 'AC Installation', matchKeywords: ['ac installation', 'ac install', 'new air conditioner', 'install ac'], shortDescription: 'New air conditioning system installation.' },
      { name: 'Heating Repair', matchKeywords: ['heating repair', 'heater repair'], shortDescription: 'Heating system repair.' },
      { name: 'Furnace Repair', matchKeywords: ['furnace repair', 'furnace'], shortDescription: 'Furnace diagnosis and repair.' },
      { name: 'Furnace Installation', matchKeywords: ['furnace installation', 'furnace install', 'new furnace'], shortDescription: 'New furnace installation.' },
      { name: 'Heat Pump Repair', matchKeywords: ['heat pump repair', 'heat pump'], shortDescription: 'Heat pump repair.' },
      { name: 'Heat Pump Installation', matchKeywords: ['heat pump installation', 'heat pump install'], shortDescription: 'Heat pump installation.' },
      { name: 'HVAC Maintenance', matchKeywords: ['maintenance', 'tune up', 'hvac maintenance', 'tune-up'], shortDescription: 'Preventive HVAC maintenance and tune-ups.' },
      { name: 'Indoor Air Quality', matchKeywords: ['air quality', 'indoor air', 'air purifier', 'iaq'], shortDescription: 'Indoor air quality solutions.' },
      { name: 'Ductwork', matchKeywords: ['duct', 'ductwork', 'duct cleaning', 'duct repair'], shortDescription: 'Ductwork installation, repair, and cleaning.' },
      { name: 'Thermostat Installation', matchKeywords: ['thermostat', 'smart thermostat'], shortDescription: 'Thermostat installation and upgrades.' },
      { name: 'Emergency HVAC Service', matchKeywords: ['emergency', 'emergency hvac', '24/7', 'emergency service'], shortDescription: '24/7 emergency HVAC service.' },
      { name: 'Commercial HVAC', matchKeywords: ['commercial hvac', 'commercial'], conditional: true, shortDescription: 'Commercial HVAC service and installation.' },
    ],
  },
  // Additional industries (placeholders for future expansion; no services yet)
  { name: 'Plumbing', description: 'Plumbing repair and installation services.', matchKeywords: ['plumbing', 'plumber', 'drain', 'water heater', 'sewer', 'pipe repair'], gbpCategories: ['Plumber', 'Plumbing supply store'], services: [] },
  { name: 'Roofing', description: 'Residential and commercial roofing contractors.', matchKeywords: ['roofing', 'roofer', 'roof repair', 'roof replacement', 'shingle'], gbpCategories: ['Roofing contractor'], services: [] },
  { name: 'Legal', description: 'Law firms and attorneys.', matchKeywords: ['law firm', 'attorney', 'lawyer', 'legal', 'law office'], gbpCategories: ['Attorney', 'Law firm', 'Legal services'], services: [] },
  { name: 'Restaurant', description: 'Restaurants and food service establishments.', matchKeywords: ['restaurant', 'dining', 'cafe', 'eatery', 'bistro', 'grill'], gbpCategories: ['Restaurant', 'Cafe', 'Bar & grill'], services: [] },
  { name: 'Med Spa', description: 'Medical spas offering aesthetic treatments.', matchKeywords: ['med spa', 'medspa', 'medical spa', 'botox', 'aesthetic', 'laser'], gbpCategories: ['Medical spa', 'Skin care clinic'], services: [] },
  { name: 'Chiropractic', description: 'Chiropractic clinics.', matchKeywords: ['chiropractic', 'chiropractor', 'spinal', 'adjustment'], gbpCategories: ['Chiropractor'], services: [] },
  { name: 'Real Estate', description: 'Real estate agencies and agents.', matchKeywords: ['real estate', 'realtor', 'realty', 'homes for sale', 'property'], gbpCategories: ['Real estate agency', 'Real estate agent'], services: [] },
  { name: 'Home Services', description: 'General home services and handyman contractors.', matchKeywords: ['home services', 'handyman', 'home repair', 'remodeling', 'home improvement'], gbpCategories: ['Handyman', 'General contractor', 'Home improvement'], services: [] },
  { name: 'Pest Control', description: 'Pest control and extermination services.', matchKeywords: ['pest control', 'exterminator', 'pest', 'termite', 'rodent'], gbpCategories: ['Pest control service'], services: [] },
  { name: 'Landscaping', description: 'Landscaping and lawn care companies.', matchKeywords: ['landscaping', 'lawn care', 'landscape', 'lawn', 'yard'], gbpCategories: ['Landscaper', 'Lawn care service'], services: [] },
  { name: 'Insurance', description: 'Insurance agencies and brokers.', matchKeywords: ['insurance', 'insurance agency', 'insurance agent', 'coverage', 'policy'], gbpCategories: ['Insurance agency'], services: [] },
  { name: 'Accounting / Tax', description: 'Accounting, bookkeeping, and tax preparation firms.', matchKeywords: ['accounting', 'tax', 'cpa', 'bookkeeping', 'tax preparation', 'accountant'], gbpCategories: ['Accountant', 'Tax preparation service', 'Bookkeeping service'], services: [] },
];

async function main() {
  let industryCount = 0;
  let serviceCount = 0;

  for (let i = 0; i < INDUSTRIES.length; i++) {
    const ind = INDUSTRIES[i];
    const slug = slugify(ind.name);
    const industry = await prisma.industry.upsert({
      where: { slug },
      update: {
        name: ind.name,
        description: ind.description,
        matchKeywords: ind.matchKeywords,
        gbpCategories: ind.gbpCategories,
        sortOrder: i,
        // do not flip enabled off if an admin disabled it
      },
      create: {
        name: ind.name,
        slug,
        description: ind.description,
        matchKeywords: ind.matchKeywords,
        gbpCategories: ind.gbpCategories,
        sortOrder: i,
        enabled: true,
      },
    });
    industryCount++;

    for (let j = 0; j < ind.services.length; j++) {
      const svc = ind.services[j];
      const svcSlug = slugify(svc.name);
      await prisma.industryService.upsert({
        where: { industryId_slug: { industryId: industry.id, slug: svcSlug } },
        update: {
          name: svc.name,
          shortDescription: svc.shortDescription ?? '',
          customerProblem: svc.customerProblem ?? '',
          commonQuestions: (svc.commonQuestions ?? []) as any,
          commonObjections: (svc.commonObjections ?? []) as any,
          relatedServices: (svc.relatedServices ?? []) as any,
          matchKeywords: svc.matchKeywords ?? [svc.name.toLowerCase()],
          conditional: svc.conditional ?? false,
          recommendedSchemaType: svc.schemaType ?? 'Service',
          sortOrder: j,
        },
        create: {
          industryId: industry.id,
          name: svc.name,
          slug: svcSlug,
          shortDescription: svc.shortDescription ?? '',
          customerProblem: svc.customerProblem ?? '',
          commonQuestions: (svc.commonQuestions ?? []) as any,
          commonObjections: (svc.commonObjections ?? []) as any,
          relatedServices: (svc.relatedServices ?? []) as any,
          matchKeywords: svc.matchKeywords ?? [svc.name.toLowerCase()],
          conditional: svc.conditional ?? false,
          recommendedSchemaType: svc.schemaType ?? 'Service',
          sortOrder: j,
          enabled: true,
        },
      });
      serviceCount++;
    }
  }

  console.log(`Industry seed complete: ${industryCount} industries, ${serviceCount} services.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
