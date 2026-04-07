/**
 * Phase 2: Geography Reference Layer Import
 * Reads ZipsRV1.csv (31,273 delivery-point ZIPs) and populates:
 *   GeoState → GeoCounty → GeoCity → GeoZip → GeoCityZip
 *
 * Uses raw SQL batch inserts to avoid connection pool exhaustion.
 * Usage: cd nextjs_space && npx tsx scripts/import-geo-data.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function cuid(): string {
  return 'c' + randomBytes(12).toString('hex');
}

// ── State name lookup ─────────────────────────────────────────
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

interface CsvRow {
  zipCode: string;
  latitude: number;
  longitude: number;
  stateCode: string;
  city: string;
  countyName: string;
  countyFips: string;
  stateFips: string;
  fullFips: string;
}

function parseCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;
    const stateFips = cols[7].trim().padStart(2, '0');
    const countyFips = cols[6].trim().padStart(3, '0');
    rows.push({
      zipCode: cols[0].trim().padStart(5, '0'),
      latitude: parseFloat(cols[1]),
      longitude: parseFloat(cols[2]),
      stateCode: cols[3].trim().toUpperCase(),
      city: cols[4].trim().toUpperCase(),
      countyName: cols[5].trim().toUpperCase(),
      countyFips,
      stateFips,
      fullFips: `${stateFips}${countyFips}`,
    });
  }
  return rows;
}

/** Escape a string for SQL single quotes */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  const csvPath = path.resolve(__dirname, '../data/ZipsRV1.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('❌ ZipsRV1.csv not found at', csvPath);
    process.exit(1);
  }

  console.log('📖 Parsing CSV...');
  const rows = parseCsv(csvPath);
  console.log(`   ${rows.length} rows parsed`);

  // ── 1. GeoState (small — use Prisma upsert) ─────────────────
  const stateSet = new Map<string, { code: string; name: string; fips: string }>();
  for (const r of rows) {
    if (!stateSet.has(r.stateCode)) {
      stateSet.set(r.stateCode, {
        code: r.stateCode,
        name: STATE_NAMES[r.stateCode] || r.stateCode,
        fips: r.stateFips,
      });
    }
  }
  console.log(`\n🗺️  Upserting ${stateSet.size} states...`);
  const stateIds: Record<string, string> = {};
  for (const s of stateSet.values()) {
    const rec = await prisma.geoState.upsert({
      where: { code: s.code },
      update: { name: s.name, fipsCode: s.fips },
      create: { code: s.code, name: s.name, fipsCode: s.fips },
    });
    stateIds[s.code] = rec.id;
  }
  console.log(`   ✅ ${Object.keys(stateIds).length} states`);

  // ── 2. GeoCounty via raw SQL batch ──────────────────────────
  const countySet = new Map<string, { name: string; fullFips: string; stateCode: string }>();
  for (const r of rows) {
    if (!countySet.has(r.fullFips)) {
      countySet.set(r.fullFips, { name: r.countyName, fullFips: r.fullFips, stateCode: r.stateCode });
    }
  }
  console.log(`\n🏛️  Upserting ${countySet.size} counties via SQL...`);
  const countyArr = Array.from(countySet.values());
  const BATCH = 200;
  for (let i = 0; i < countyArr.length; i += BATCH) {
    const batch = countyArr.slice(i, i + BATCH);
    const values = batch.map(c => {
      const id = cuid();
      return `('${id}', '${esc(c.name)}', '${c.fullFips}', '${stateIds[c.stateCode]}', NOW())`;
    }).join(',\n');
    await prisma.$executeRawUnsafe(`
      INSERT INTO "GeoCounty" (id, name, "fipsCode", "stateId", "createdAt")
      VALUES ${values}
      ON CONFLICT ("fipsCode") DO UPDATE SET name = EXCLUDED.name, "stateId" = EXCLUDED."stateId"
    `);
    if ((i + BATCH) % 1000 < BATCH) console.log(`   ... ${Math.min(i + BATCH, countyArr.length)}/${countyArr.length}`);
  }
  // Load county IDs back
  const countyRows = await prisma.geoCounty.findMany({ select: { id: true, fipsCode: true } });
  const countyIds: Record<string, string> = {};
  for (const c of countyRows) {
    if (c.fipsCode) countyIds[c.fipsCode] = c.id;
  }
  console.log(`   ✅ ${countyRows.length} counties`);

  // ── 3. GeoCity via raw SQL batch ────────────────────────────
  interface CityAgg { name: string; fullFips: string; lats: number[]; lons: number[] }
  const cityMap = new Map<string, CityAgg>();
  for (const r of rows) {
    const key = `${r.stateCode}|${r.fullFips}|${r.city}`;
    const existing = cityMap.get(key);
    if (existing) {
      existing.lats.push(r.latitude);
      existing.lons.push(r.longitude);
    } else {
      cityMap.set(key, { name: r.city, fullFips: r.fullFips, lats: [r.latitude], lons: [r.longitude] });
    }
  }
  console.log(`\n🏘️  Upserting ${cityMap.size} cities via SQL...`);
  // Cities don't have a unique constraint on name+countyId, so we need to
  // first check what exists. Load existing cities keyed by name+countyId.
  const existingCities = await prisma.geoCity.findMany({ select: { id: true, name: true, countyId: true } });
  const existingCityMap = new Map<string, string>();
  for (const c of existingCities) {
    existingCityMap.set(`${c.name}|${c.countyId}`, c.id);
  }
  console.log(`   (${existingCities.length} cities already in DB)`);

  const cityIds: Record<string, string> = {}; // our key → db id
  const citiesToInsert: { id: string; name: string; countyId: string; lat: number; lon: number; key: string }[] = [];
  const citiesToUpdate: { id: string; lat: number; lon: number }[] = [];

  for (const [key, c] of cityMap.entries()) {
    const countyId = countyIds[c.fullFips];
    if (!countyId) continue;
    const avgLat = c.lats.reduce((a, b) => a + b, 0) / c.lats.length;
    const avgLon = c.lons.reduce((a, b) => a + b, 0) / c.lons.length;
    const existingId = existingCityMap.get(`${c.name}|${countyId}`);
    if (existingId) {
      cityIds[key] = existingId;
      citiesToUpdate.push({ id: existingId, lat: avgLat, lon: avgLon });
    } else {
      const id = cuid();
      cityIds[key] = id;
      citiesToInsert.push({ id, name: c.name, countyId, lat: avgLat, lon: avgLon, key });
    }
  }

  // Batch insert new cities
  if (citiesToInsert.length > 0) {
    console.log(`   Inserting ${citiesToInsert.length} new cities...`);
    for (let i = 0; i < citiesToInsert.length; i += BATCH) {
      const batch = citiesToInsert.slice(i, i + BATCH);
      const values = batch.map(c =>
        `('${c.id}', '${esc(c.name)}', '${c.countyId}', ${c.lat}, ${c.lon}, NOW())`
      ).join(',\n');
      await prisma.$executeRawUnsafe(`
        INSERT INTO "GeoCity" (id, name, "countyId", latitude, longitude, "createdAt")
        VALUES ${values}
      `);
      if ((i + BATCH) % 5000 < BATCH) console.log(`   ... ${Math.min(i + BATCH, citiesToInsert.length)}/${citiesToInsert.length}`);
    }
  }

  // Batch update existing cities' lat/lon
  if (citiesToUpdate.length > 0) {
    console.log(`   Updating ${citiesToUpdate.length} existing cities...`);
    for (let i = 0; i < citiesToUpdate.length; i += BATCH) {
      const batch = citiesToUpdate.slice(i, i + BATCH);
      // Use a CASE statement for batch update
      const ids = batch.map(c => `'${c.id}'`).join(',');
      const latCase = batch.map(c => `WHEN '${c.id}' THEN ${c.lat}`).join(' ');
      const lonCase = batch.map(c => `WHEN '${c.id}' THEN ${c.lon}`).join(' ');
      await prisma.$executeRawUnsafe(`
        UPDATE "GeoCity" SET
          latitude = CASE id ${latCase} END,
          longitude = CASE id ${lonCase} END
        WHERE id IN (${ids})
      `);
      if ((i + BATCH) % 5000 < BATCH) console.log(`   ... ${Math.min(i + BATCH, citiesToUpdate.length)}/${citiesToUpdate.length}`);
    }
  }
  console.log(`   ✅ ${Object.keys(cityIds).length} cities`);

  // ── 4. GeoZip via raw SQL batch ─────────────────────────────
  console.log(`\n📮 Upserting ${rows.length} ZIPs via SQL...`);
  // Deduplicate zips (same zip can appear in multiple city rows)
  const zipMap = new Map<string, { lat: number; lon: number }>();
  for (const r of rows) {
    if (!zipMap.has(r.zipCode)) {
      zipMap.set(r.zipCode, { lat: r.latitude, lon: r.longitude });
    }
  }
  const zipArr = Array.from(zipMap.entries());
  for (let i = 0; i < zipArr.length; i += BATCH) {
    const batch = zipArr.slice(i, i + BATCH);
    const values = batch.map(([code, z]) => {
      const id = cuid();
      return `('${id}', '${code}', ${z.lat}, ${z.lon}, NOW())`;
    }).join(',\n');
    await prisma.$executeRawUnsafe(`
      INSERT INTO "GeoZip" (id, code, latitude, longitude, "createdAt")
      VALUES ${values}
      ON CONFLICT (code) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
    `);
    if ((i + BATCH) % 5000 < BATCH) console.log(`   ... ${Math.min(i + BATCH, zipArr.length)}/${zipArr.length}`);
  }
  // Load zip IDs back
  const zipRows = await prisma.geoZip.findMany({ select: { id: true, code: true } });
  const zipIds: Record<string, string> = {};
  for (const z of zipRows) { zipIds[z.code] = z.id; }
  console.log(`   ✅ ${zipRows.length} ZIPs`);

  // ── 5. GeoCityZip links via raw SQL batch ───────────────────
  console.log(`\n🔗 Building GeoCityZip links...`);
  const zipPrimarySet = new Set<string>();
  interface LinkRow { cityId: string; zipId: string; isPrimary: boolean }
  const links: LinkRow[] = [];
  for (const r of rows) {
    const cityKey = `${r.stateCode}|${r.fullFips}|${r.city}`;
    const cityId = cityIds[cityKey];
    const zipId = zipIds[r.zipCode];
    if (!cityId || !zipId) continue;
    const isPrimary = !zipPrimarySet.has(r.zipCode);
    if (isPrimary) zipPrimarySet.add(r.zipCode);
    links.push({ cityId, zipId, isPrimary });
  }
  // Deduplicate links (same city+zip pair)
  const linkDedup = new Map<string, LinkRow>();
  for (const l of links) {
    const key = `${l.cityId}|${l.zipId}`;
    if (!linkDedup.has(key)) linkDedup.set(key, l);
  }
  const linkArr = Array.from(linkDedup.values());
  console.log(`   ${linkArr.length} unique links to upsert...`);
  for (let i = 0; i < linkArr.length; i += BATCH) {
    const batch = linkArr.slice(i, i + BATCH);
    const values = batch.map(l => {
      const id = cuid();
      return `('${id}', '${l.cityId}', '${l.zipId}', ${l.isPrimary})`;
    }).join(',\n');
    await prisma.$executeRawUnsafe(`
      INSERT INTO "GeoCityZip" (id, "cityId", "zipId", "isPrimary")
      VALUES ${values}
      ON CONFLICT ("cityId", "zipId") DO UPDATE SET "isPrimary" = EXCLUDED."isPrimary"
    `);
    if ((i + BATCH) % 5000 < BATCH) console.log(`   ... ${Math.min(i + BATCH, linkArr.length)}/${linkArr.length}`);
  }
  console.log(`   ✅ ${linkArr.length} city↔zip links`);

  // ── Summary ─────────────────────────────────────────────────
  const [stateN, countyN, cityN, zipN, linkN] = await Promise.all([
    prisma.geoState.count(),
    prisma.geoCounty.count(),
    prisma.geoCity.count(),
    prisma.geoZip.count(),
    prisma.geoCityZip.count(),
  ]);
  console.log('\n═══════════════════════════════════════');
  console.log('  Phase 2 Geography Import Complete');
  console.log('═══════════════════════════════════════');
  console.log(`  GeoState:   ${stateN}`);
  console.log(`  GeoCounty:  ${countyN}`);
  console.log(`  GeoCity:    ${cityN}`);
  console.log(`  GeoZip:     ${zipN}`);
  console.log(`  GeoCityZip: ${linkN}`);
  console.log('═══════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
