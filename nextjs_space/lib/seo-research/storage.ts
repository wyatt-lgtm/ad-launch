/**
 * SEO Research — raw payload storage (R2 / S3).
 *
 * Raw fetched competitor page payloads are stored as objects in cloud storage
 * and referenced from Postgres by their object key (never stored inline).
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from '@/lib/aws-config';

/**
 * Store a raw fetched payload (HTML/JSON/text) for audit and return the object
 * key (cloud_storage_path). Failures are swallowed and return null so research
 * is never blocked purely by a storage hiccup.
 */
export async function storeRawSeoSnapshot(params: {
  businessId: string;
  kind: 'competitor_page' | 'meta_analysis_inputs';
  identifier: string; // url or analysis id (sanitized internally)
  body: string;
  contentType?: string;
}): Promise<string | null> {
  try {
    const { bucketName, folderPrefix } = getBucketConfig();
    if (!bucketName) return null;
    const safeId = params.identifier.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const key = `${folderPrefix}seo-research/${params.businessId}/${params.kind}/${Date.now()}-${safeId}.txt`;
    const s3 = createS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: params.body,
        ContentType: params.contentType || 'text/plain; charset=utf-8',
      }),
    );
    return key;
  } catch (err) {
    console.error('[seo-research] storeRawSeoSnapshot failed:', err);
    return null;
  }
}
