import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const storage = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: true,
});

const bucket = "assets";

export function isAvatarKey(value: string) {
  return value.startsWith("avatars/");
}

export async function signAvatar(value: string) {
  if (!isAvatarKey(value)) return value;
  return getSignedUrl(storage, new GetObjectCommand({ Bucket: bucket, Key: value }), { expiresIn: 3600 });
}

export async function saveAvatar(key: string, file: File) {
  await storage.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
  }));
}