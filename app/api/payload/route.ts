import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import postgres from "postgres";

export const runtime = "nodejs";

const sql = postgres(process.env.DB_URL ?? "");
const storage = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: true,
});

export async function POST(request: Request) {
  const formData = await request.formData();
  const messageValue = formData.get("message");
  const fileValue = formData.get("file");
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  if (!message && !file) {
    return Response.json({ error: "Add a message or choose a file first." }, { status: 400 });
  }

  if (file && file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "Files must be smaller than 10 MB." }, { status: 413 });
  }

  const id = randomUUID();
  const objectKey = file ? `payloads/${id}/${file.name}` : null;

  try {
    if (file && objectKey) {
      await storage.send(new PutObjectCommand({
        Bucket: "assets",
        Key: objectKey,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: file.type || "application/octet-stream",
      }));
    }

    await sql`
      CREATE TABLE IF NOT EXISTS payloads (
        id uuid PRIMARY KEY,
        message text NOT NULL DEFAULT '',
        object_key text,
        file_name text,
        file_type text,
        file_size integer,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    await sql`
      INSERT INTO payloads (id, message, object_key, file_name, file_type, file_size)
      VALUES (${id}, ${message}, ${objectKey}, ${file?.name ?? null}, ${file?.type ?? null}, ${file?.size ?? null})
    `;

    return Response.json({ id, message: "Payload uploaded." }, { status: 201 });
  } catch (error) {
    console.error("Payload upload failed", error);
    return Response.json({ error: "Upload failed. Check the server configuration and try again." }, { status: 500 });
  }
}
