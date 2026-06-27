export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/shared-assets';
import { generatePresignedUploadUrl } from '@/lib/s3';

/**
 * POST /api/shared-assets/upload
 * Returns a presigned S3 upload URL. Admin only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { filename, contentType } = await req.json();
    if (!filename || !contentType) {
      return NextResponse.json({ error: 'filename and contentType are required' }, { status: 400 });
    }

    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(
      `shared-assets/${filename}`,
      contentType,
    );

    return NextResponse.json({ uploadUrl, cloudStoragePath: cloud_storage_path });
  } catch (err) {
    console.error('[SharedAssets Upload]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
