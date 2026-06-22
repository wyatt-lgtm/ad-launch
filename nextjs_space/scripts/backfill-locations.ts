import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Backfill: For every existing Business with a confirmed address,
 * create a BusinessLocation row (location_number=1, is_primary=true)
 * if one doesn't already exist.
 */
async function main() {
  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { businessCity: { not: null } },
        { businessZip: { not: null } },
        { businessAddr: { not: null } },
      ],
    },
    include: {
      locations: { take: 1 },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const biz of businesses) {
    if (biz.locations.length > 0) {
      skipped++;
      continue;
    }

    // Only backfill if there's at least city or zip
    if (!biz.businessCity && !biz.businessZip) {
      skipped++;
      continue;
    }

    try {
      await prisma.businessLocation.create({
        data: {
          businessId: biz.id,
          locationNumber: 1,
          locationName: biz.businessName || null,
          address1: biz.businessAddr || null,
          city: biz.businessCity || null,
          state: biz.businessState || null,
          postalCode: biz.businessZip || null,
          phone: biz.businessPhone || null,
          isPrimary: true,
          isConfirmed: true,
          source: 'existing_business',
        },
      });
      created++;
    } catch (err: any) {
      // Unique constraint violation = already exists, skip
      if (err?.code === 'P2002') {
        skipped++;
      } else {
        console.error(`Failed to backfill business ${biz.id}:`, err?.message);
      }
    }
  }

  console.log(`Backfill complete: ${created} locations created, ${skipped} skipped`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
