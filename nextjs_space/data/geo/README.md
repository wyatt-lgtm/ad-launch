# Geographic Reference Data

## Overview

This directory holds the canonical ZIP / City / County / FIPS / State
reference file used to seed the Tombstone geographic hierarchy.

## Files

| File | Description |
|------|-------------|
| `zip_city_county_fips.csv` | 40,753-row CSV with every US delivery-point ZIP code, its primary city, county, state, and FIPS codes. |

## CSV Columns

| Column | Example | Notes |
|--------|---------|-------|
| `zip` | `07087` | 5-digit, leading-zero preserved |
| `primary_record` | `P` | Always "P" in this dataset |
| `is_primary` | `True` | Boolean flag |
| `state` | `NJ` | 2-letter USPS code |
| `state_name` | `NEW JERSEY` | Full name, uppercase |
| `city` | `WEEHAWKEN` | Display name, uppercase |
| `city_key` | `WEEHAWKEN` | Lookup key, uppercase |
| `county` | `HUDSON` | Display name, uppercase |
| `county_key` | `HUDSON` | Lookup key, uppercase |
| `county_fips_3` | `017` | 3-digit county FIPS (within state) |
| `state_fips` | `34` | 2-digit state FIPS |
| `county_fips` | `34017` | Full 5-digit county FIPS |
| `finance_number` | `...` | USPS finance number |

## Database Tables

The data maps to the existing Prisma schema:

```
GeoState  (54 rows)  ← code, name, fipsCode
  └─ GeoCounty  (3,114 rows)  ← name, fipsCode
       └─ GeoCity  (29,405 rows)  ← name
            └─ GeoCityZip (join)  ← isPrimary
                 └─ GeoZip  (40,753 rows)  ← code, latitude, longitude
```

## Ingest Script

The one-time ingest script lives at `scripts/ingest-geo-data.ts`.

```bash
# Validate only (no DB writes)
DATABASE_URL=$(grep DATABASE_URL .env | cut -d"'" -f2) npx tsx scripts/ingest-geo-data.ts --validate

# Dry run (show what would change)
DATABASE_URL=$(grep DATABASE_URL .env | cut -d"'" -f2) npx tsx scripts/ingest-geo-data.ts --dry-run

# Live ingest
DATABASE_URL=$(grep DATABASE_URL .env | cut -d"'" -f2) npx tsx scripts/ingest-geo-data.ts
```

The script is idempotent — re-running it will skip existing records.

## Lookup Utility

All geo lookups go through `lib/rss/geo-lookup.ts`, which queries the
database (not this CSV directly). Key functions:

| Function | Purpose |
|----------|--------|
| `lookupZip(zip)` | Full hierarchy for a ZIP code |
| `lookupCityState(city, state)` | ZIPs + county + FIPS for a city |
| `lookupCountyState(county, state)` | ZIPs + cities + FIPS for a county |
| `getStateFips(state)` | 2-digit state FIPS |
| `getCountyFips(county, state)` | 5-digit county FIPS |
| `normalizeZip(zip)` | Zero-pad to 5 digits |
| `normalizeCity(city)` | Uppercase + trim |
| `normalizeCounty(county)` | Uppercase + trim |
| `getZipsByRadius(zip, miles)` | ZIPs within radius |
| `getZipsByCity(city, state)` | All ZIPs in a city |
| `getZipsByCounty(county, state)` | All ZIPs in a county |
| `getZipsByState(state)` | All ZIPs in a state |
| `isValidDeliveryZip(zip)` | Check if ZIP exists |

## Refresh Procedure

1. Obtain updated XLSX from USPS/Census data source.
2. Export the `ZipGeo_Import` sheet to CSV, replacing `zip_city_county_fips.csv`.
3. Run the ingest script (it upserts — no data loss).
4. Verify counts with `--validate`.
5. If new states/territories were added, check that feeds with state-level
   geo scopes pick up the new ZIPs (run `backfillHierarchy` for affected feeds).
