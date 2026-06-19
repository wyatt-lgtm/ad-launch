export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetAccess } from '@/lib/asset-access';
import { validateAssetFile, sanitizeSvg, TEXT_ASSET_TYPES } from '@/lib/asset-validation';
import { generatePresignedUploadUrl } from '@/lib/s3';
import { prisma } from '@/lib/db';

/**
 * POST /api/assets/upload
 *
 * Two modes:
 * 1. File upload: Returns a presigned URL for direct S3 upload + creates asset record
 * 2. Text asset: Creates a text-based asset (claims, disclaimers, etc.)
 *
 * Required fields: businessId, assetType, category, title
 * For files: fileName, mimeType, fileSizeBytes
 * For text: textContent
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      businessId,
      assetType,
      category,
      title,
      description = '',
      tags = [],
      // File upload fields
      fileName,
      mimeType,
      fileSizeBytes,
      width,
      height,
      // Text asset fields
      textContent,
      // Optional metadata
      usageRights,
      allowedChannels = [],
      disallowedChannels = [],
      priorityScore = 0,
      expiresAt,
      sourcePlatform,
      customerPermission,
      approvedForAds = false,
      exampleType,
      pairTag,
      pairRole,
      expirationDate,
    } = body;

    // Validate required fields
    if (!businessId || !assetType || !category || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: businessId, assetType, category, title' },
        { status: 400 }
      );
    }

    // Access control: verify registered owner/admin
    const access = await verifyAssetAccess(businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    const isTextAsset = TEXT_ASSET_TYPES.includes(assetType);

    if (isTextAsset) {
      // Text-based asset (claims, disclaimers, font notes, color palette)
      if (!textContent || typeof textContent !== 'string' || !textContent.trim()) {
        return NextResponse.json({ error: 'Text content is required for this asset type.' }, { status: 400 });
      }

      // Get tombstone IDs from the business
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { tombstoneBusinessId: true, tombstoneBusinessUuid: true },
      });

      const asset = await prisma.businessAsset.create({
        data: {
          businessId,
          tombstoneBusinessId: business?.tombstoneBusinessId,
          tombstoneBusinessUuid: business?.tombstoneBusinessUuid,
          uploadedByUserId: access.userId!,
          assetType,
          category,
          title: title.trim(),
          description: description.trim(),
          tags,
          originalFilename: `${assetType}.txt`,
          mimeType: 'text/plain',
          fileSizeBytes: Buffer.byteLength(textContent, 'utf-8'),
          cloudStoragePath: '', // no file
          isPublic: false,
          textContent: textContent.trim(),
          approvalStatus: 'uploaded',
          usageRights,
          allowedChannels,
          disallowedChannels,
          priorityScore,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          approvedForAds,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined,
        },
      });

      return NextResponse.json({ asset, mode: 'text' });
    }

    // File-based asset
    if (!fileName || !mimeType || !fileSizeBytes) {
      return NextResponse.json(
        { error: 'File uploads require fileName, mimeType, and fileSizeBytes.' },
        { status: 400 }
      );
    }

    // Validate file
    const validation = validateAssetFile(assetType, fileName, mimeType, fileSizeBytes, width, height);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Generate presigned upload URL
    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(
      fileName,
      mimeType,
      true // public for asset library
    );

    // Get tombstone IDs from the business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { tombstoneBusinessId: true, tombstoneBusinessUuid: true },
    });

    // Create asset record in pending state
    const asset = await prisma.businessAsset.create({
      data: {
        businessId,
        tombstoneBusinessId: business?.tombstoneBusinessId,
        tombstoneBusinessUuid: business?.tombstoneBusinessUuid,
        uploadedByUserId: access.userId!,
        assetType,
        category,
        title: title.trim(),
        description: description.trim(),
        tags,
        originalFilename: fileName,
        mimeType,
        fileSizeBytes,
        width: width || null,
        height: height || null,
        cloudStoragePath: cloud_storage_path,
        isPublic: true,
        approvalStatus: 'uploaded',
        usageRights,
        allowedChannels,
        disallowedChannels,
        priorityScore,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        sourcePlatform,
        customerPermission,
        approvedForAds,
        exampleType,
        pairTag,
        pairRole,
        expirationDate: expirationDate ? new Date(expirationDate) : undefined,
      },
    });

    return NextResponse.json({
      asset,
      uploadUrl,
      cloud_storage_path,
      warning: validation.warning,
      mode: 'file',
    });
  } catch (err: any) {
    console.error('[assets/upload] Error:', err);
    return NextResponse.json({ error: 'Failed to process upload request.' }, { status: 500 });
  }
}
