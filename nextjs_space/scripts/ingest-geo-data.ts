// @ts-nocheck
/**
 * Ingest ZIP/City/County/FIPS/State reference data from CSV into GeoState/GeoCounty/GeoCity/GeoZip/GeoCityZip tables.
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/ingest-geo-data.ts                # full ingest
 *   cd nextjs_space && npx tsx scripts/ingest-geo-data.ts --dry-run      # preview only
 *   cd nextjs_space && npx tsx scripts/ingest-geo-data.ts --validate     # validate CSV only
 *
 * Safety:
 *   - Never deletes existing records
 *   - Uses upsert to avoid duplicates
 *   - Preserves existing lat/lon on GeoZip if already set
 *   - Existing FeedGeo links are not affected
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CsvRow {
  zip: string;
  primary_record: string;
  is_primary: string;
  state: string;
  state_name: string;
  city: string;
  city_key: string;
  county: string;
  county_key: string;
  county_fips_3: string;
  state_fips: string;
  county_fips: string;
  finance_number: string;
}

// ── CSV Parser (no external deps) ──────────────────────────────────────
function parseCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row as CsvRow);
  }
  return rows;
}

// ── Validation ─────────────────────────────────────────────────────────
interface ValidationResult {
  totalRows: number;
  uniqueZips: number;
  uniqueCounties: number;
  uniqueStates: number;
  uniqueCities: number;
  duplicateZips: number;
  invalidRows: string[];
  missingFips: number;
}

function validate(rows: CsvRow[]): ValidationResult {
  const zipSet = new Set<string>();
  const countySet = new Set<string>();
  const stateSet = new Set<string>();
  const citySet = new Set<string>();
  const invalidRows: string[] = [];
  let duplicateZips = 0;
  let missingFips = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2; // 1-based + header
    const zip = row.zip?.padStart(5, '0');

    // ZIP must be 5 digits
    if (!zip || !/^\d{5}$/.test(zip)) {
      invalidRows.push(`Line ${lineNum}: Invalid ZIP '${row.zip}'`);
      continue;
    }

    // State must be 2 letters
    if (!row.state || !/^[A-Z]{2}$/.test(row.state)) {
      invalidRows.push(`Line ${lineNum}: Invalid state '${row.state}' for ZIP ${zip}`);
      continue;
    }

    // City and county must not be empty
    if (!row.city?.trim()) {
      invalidRows.push(`Line ${lineNum}: Missing city for ZIP ${zip}`);
      continue;
    }
    if (!row.county?.trim()) {
      invalidRows.push(`Line ${lineNum}: Missing county for ZIP ${zip}`);
      continue;
    }

    // FIPS validation
    if (!row.state_fips || !/^\d{2}$/.test(row.state_fips)) {
      missingFips++;
    }
    if (!row.county_fips || !/^\d{5}$/.test(row.county_fips)) {
      missingFips++;
    }

    if (zipSet.has(zip)) { duplicateZips++; }
    zipSet.add(zip);
    stateSet.add(row.state);
    countySet.add(`${row.county_key}|${row.state}`);
    citySet.add(`${row.city_key}|${row.county_key}|${row.state}`);
  }

  return {
    totalRows: rows.length,
    uniqueZips: zipSet.size,
    uniqueCounties: countySet.size,
    uniqueStates: stateSet.size,
    uniqueCities: citySet.size,
    duplicateZips,
    invalidRows,
    missingFips,
  };
}

// ── Ingest ─────────────────────────────────────────────────────────────
async function ingest(rows: CsvRow[], dryRun: boolean) {
  const start = Date.now();

  // ── 1. Build unique sets ─────────────────────────────────────────
  const statesMap = new Map<string, { code: string; name: string; fips: string }>();
  const countiesMap = new Map<string, { name: string; nameKey: string; stateCode: string; fips: string }>();
  const citiesMap = new Map<string, { name: string; nameKey: string; countyKey: string; stateCode: string }>();
  const zipRows: { zip: string; cityKey: string; countyKey: string; stateCode: string; isPrimary: boolean }[] = [];

  for (const row of rows) {
    const zip = row.zip.padStart(5, '0');
    if (!/^\d{5}$/.test(zip) || !/^[A-Z]{2}$/.test(row.state)) continue;

    statesMap.set(row.state, { code: row.state, name: row.state_name, fips: row.state_fips?.padStart(2, '0') || '' });
    
    const countyKey = `${row.county_key}|${row.state}`;
    countiesMap.set(countyKey, {
      name: row.county,
      nameKey: row.county_key,
      stateCode: row.state,
      fips: row.county_fips?.padStart(5, '0') || '',
    });

    const cityKey = `${row.city_key}|${row.county_key}|${row.state}`;
    citiesMap.set(cityKey, {
      name: row.city,
      nameKey: row.city_key,
      countyKey: row.county_key,
      stateCode: row.state,
    });

    zipRows.push({
      zip,
      cityKey: row.city_key,
      countyKey: row.county_key,
      stateCode: row.state,
      isPrimary: row.is_primary === 'True',
    });
  }

  console.log(`\n  Unique states: ${statesMap.size}`);
  console.log(`  Unique counties: ${countiesMap.size}`);
  console.log(`  Unique cities: ${citiesMap.size}`);
  console.log(`  ZIP rows: ${zipRows.length}`);

  if (dryRun) {
    console.log('\n  [DRY RUN] No database changes made.');
    return;
  }

  // ── 2. Upsert States ─────────────────────────────────────────────
  console.log('\n  Upserting states...');
  const stateIdMap = new Map<string, string>();
  let statesCreated = 0;
  let statesUpdated = 0;
  for (const [, s] of statesMap) {
    const existing = await prisma.geoState.findUnique({ where: { code: s.code } });
    if (existing) {
      // Update FIPS if missing
      if (!existing.fipsCode && s.fips) {
        await prisma.geoState.update({ where: { id: existing.id }, data: { fipsCode: s.fips } });
        statesUpdated++;
      }
      stateIdMap.set(s.code, existing.id);
    } else {
      const created = await prisma.geoState.create({
        data: { code: s.code, name: s.name, fipsCode: s.fips || null },
      });
      stateIdMap.set(s.code, created.id);
      statesCreated++;
    }
  }
  console.log(`    States: ${statesCreated} created, ${statesUpdated} FIPS updated, ${stateIdMap.size} total`);

  // ── 3. Upsert Counties ───────────────────────────────────────────
  console.log('  Upserting counties...');
  const countyIdMap = new Map<string, string>(); // "COUNTYKEY|STATE" -> id
  let countiesCreated = 0;
  let countiesUpdated = 0;
  for (const [key, c] of countiesMap) {
    const stateId = stateIdMap.get(c.stateCode);
    if (!stateId) continue;

    const existing = await prisma.geoCounty.findFirst({
      where: { name: c.nameKey, stateId },
    });
    if (existing) {
      // Update FIPS if missing or different
      if (c.fips && (!existing.fipsCode || existing.fipsCode !== c.fips)) {
        // fipsCode is unique, check if it's taken
        try {
          await prisma.geoCounty.update({ where: { id: existing.id }, data: { fipsCode: c.fips } });
          countiesUpdated++;
        } catch (e: any) {
          // Skip unique constraint conflicts
          if (!e?.message?.includes('Unique constraint')) {
            console.error(`    Error updating county ${c.nameKey}: ${e.message}`);
          }
        }
      }
      countyIdMap.set(key, existing.id);
    } else {
      try {
        const created = await prisma.geoCounty.create({
          data: { name: c.nameKey, stateId, fipsCode: c.fips || null },
        });
        countyIdMap.set(key, created.id);
        countiesCreated++;
      } catch (e: any) {
        if (e?.message?.includes('Unique constraint')) {
          // FIPS conflict — find by FIPS
          const byFips = await prisma.geoCounty.findUnique({ where: { fipsCode: c.fips } });
          if (byFips) countyIdMap.set(key, byFips.id);
        } else {
          console.error(`    Error creating county ${c.nameKey}: ${e.message}`);
        }
      }
    }
  }
  console.log(`    Counties: ${countiesCreated} created, ${countiesUpdated} FIPS updated, ${countyIdMap.size} resolved`);

  // ── 4. Upsert Cities ─────────────────────────────────────────────
  console.log('  Upserting cities...');
  const cityIdMap = new Map<string, string>(); // "CITYKEY|COUNTYKEY|STATE" -> id
  let citiesCreated = 0;
  for (const [key, c] of citiesMap) {
    const countyKey = `${c.countyKey}|${c.stateCode}`;
    const countyId = countyIdMap.get(countyKey);
    if (!countyId) continue;

    const existing = await prisma.geoCity.findFirst({
      where: { name: c.nameKey, countyId },
    });
    if (existing) {
      cityIdMap.set(key, existing.id);
    } else {
      const created = await prisma.geoCity.create({
        data: { name: c.nameKey, countyId },
      });
      cityIdMap.set(key, created.id);
      citiesCreated++;
    }
  }
  console.log(`    Cities: ${citiesCreated} created, ${cityIdMap.size} resolved`);

  // ── 5. Upsert ZIPs + GeoCityZip links ────────────────────────────
  console.log('  Upserting ZIPs and city-zip links...');
  let zipsCreated = 0;
  let linksCreated = 0;
  let linksExist = 0;
  const BATCH = 500;

  for (let i = 0; i < zipRows.length; i += BATCH) {
    const batch = zipRows.slice(i, i + BATCH);

    for (const zr of batch) {
      // Upsert GeoZip
      let zipRecord = await prisma.geoZip.findUnique({ where: { code: zr.zip } });
      if (!zipRecord) {
        zipRecord = await prisma.geoZip.create({ data: { code: zr.zip } });
        zipsCreated++;
      }

      // Find city
      const cityKey = `${zr.cityKey}|${zr.countyKey}|${zr.stateCode}`;
      const cityId = cityIdMap.get(cityKey);
      if (!cityId) continue;

      // Upsert GeoCityZip link
      const existingLink = await prisma.geoCityZip.findUnique({
        where: { cityId_zipId: { cityId, zipId: zipRecord.id } },
      });
      if (existingLink) {
        linksExist++;
      } else {
        try {
          await prisma.geoCityZip.create({
            data: { cityId, zipId: zipRecord.id, isPrimary: zr.isPrimary },
          });
          linksCreated++;
        } catch (e: any) {
          if (!e?.message?.includes('Unique constraint')) {
            console.error(`    Error linking ZIP ${zr.zip}: ${e.message}`);
          }
        }
      }
    }

    const pct = Math.round(((i + batch.length) / zipRows.length) * 100);
    process.stdout.write(`\r    Progress: ${i + batch.length}/${zipRows.length} (${pct}%)`);
  }
  console.log();
  console.log(`    ZIPs: ${zipsCreated} created`);
  console.log(`    City-ZIP links: ${linksCreated} created, ${linksExist} already existed`);
  console.log(`\n  ✓ Ingest complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const validateOnly = args.includes('--validate');

  const csvPath = path.join(__dirname, '..', 'data', 'geo', 'zip_city_county_fips.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(' Geographic Reference Data Ingest');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Source: ${csvPath}`);
  console.log(`  Mode: ${validateOnly ? 'VALIDATE ONLY' : dryRun ? 'DRY RUN' : 'LIVE INGEST'}`);

  const rows = parseCsv(csvPath);
  const val = validate(rows);

  console.log('\n── Validation Summary ──');
  console.log(`  Total rows:       ${val.totalRows}`);
  console.log(`  Unique ZIPs:      ${val.uniqueZips}`);
  console.log(`  Unique counties:  ${val.uniqueCounties}`);
  console.log(`  Unique states:    ${val.uniqueStates}`);
  console.log(`  Unique cities:    ${val.uniqueCities}`);
  console.log(`  Duplicate ZIPs:   ${val.duplicateZips}`);
  console.log(`  Missing FIPS:     ${val.missingFips}`);
  console.log(`  Invalid rows:     ${val.invalidRows.length}`);
  if (val.invalidRows.length > 0) {
    for (const msg of val.invalidRows.slice(0, 20)) console.log(`    ⚠ ${msg}`);
    if (val.invalidRows.length > 20) console.log(`    ... and ${val.invalidRows.length - 20} more`);
  }

  if (validateOnly) {
    console.log('\n  [VALIDATE ONLY] Done.');
    await prisma.$disconnect();
    return;
  }

  await ingest(rows, dryRun);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
