import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

function shouldServeInline(contentType: string): boolean {
  return (
    (contentType.startsWith('image/') && contentType !== 'image/svg+xml') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  );
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic = false
): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const s3 = createS3Client();
  const { bucketName, folderPrefix } = getBucketConfig();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const prefix = isPublic ? 'public/uploads' : 'uploads';
  const cloud_storage_path = `${folderPrefix}${prefix}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { uploadUrl, cloud_storage_path };
}

export async function getFileUrl(
  cloud_storage_path: string,
  contentType: string,
  isPublic: boolean
): Promise<string> {
  if (isPublic) {
    const { bucketName } = getBucketConfig();
    const region = process.env.AWS_REGION || 'us-west-2';
    return `https://${bucketName}.s3.${region}.amazonaws.com/${cloud_storage_path}`;
  }
  const s3 = createS3Client();
  const { bucketName } = getBucketConfig();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ResponseContentDisposition: shouldServeInline(contentType) ? 'inline' : 'attachment',
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export async function deleteFile(cloud_storage_path: string): Promise<void> {
  const s3 = createS3Client();
  const { bucketName } = getBucketConfig();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: cloud_storage_path,
    })
  );
}
