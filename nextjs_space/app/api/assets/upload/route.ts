export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetAccess } from '@/lib/asset-access';
import { validateAssetFile, sanitizeSvg, TEXT_ASSET_TYPES, generateQualityWarnings } from '@/lib/asset-validation';
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
      // New enhanced metadata fields
      intendedUses,
      rightsConfirmed = false,
      peopleOrCustomerContent = false,
      customerPermissionConfirmed = false,
      approvedForAI = true,
      publicUseAllowed = true,
      notesForAI,
      relatedServiceTopic,
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

      const textWordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
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
          // New fields
          wordCount: textWordCount,
          extractedTextPreview: textContent.trim().substring(0, 500),
          intendedUses: intendedUses || [],
          rightsConfirmed,
          peopleOrCustomerContent,
          customerPermissionConfirmed,
          approvedForAI,
          publicUseAllowed,
          notesForAI: notesForAI || null,
          relatedServiceTopic: relatedServiceTopic || null,
          qualityStatus: 'good',
          qualityWarnings: [],
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

    // Generate quality warnings
    const qualityWarnings = generateQualityWarnings(assetType, mimeType, fileSizeBytes, width, height);
    const qualityStatus = qualityWarnings.length > 0 ? 'warning' : 'good';

    // Determine orientation from dimensions
    let orientation: string | null = null;
    if (width && height) {
      if (width > height) orientation = 'landscape';
      else if (height > width) orientation = 'portrait';
      else orientation = 'square';
    }

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
        // New fields
        orientation,
        intendedUses: intendedUses || [],
        qualityStatus,
        qualityWarnings,
        rightsConfirmed,
        peopleOrCustomerContent,
        customerPermissionConfirmed,
        approvedForAI,
        publicUseAllowed,
        notesForAI: notesForAI || null,
        relatedServiceTopic: relatedServiceTopic || null,
      },
    });

    return NextResponse.json({
      asset,
      uploadUrl,
      cloud_storage_path,
      warning: validation.warnings?.join(' '),
      qualityWarnings,
      mode: 'file',
    });
  } catch (err: any) {
    console.error('[assets/upload] Error:', err);
    return NextResponse.json({ error: 'Failed to process upload request.' }, { status: 500 });
  }
}
