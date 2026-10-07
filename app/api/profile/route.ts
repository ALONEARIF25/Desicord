import { randomUUID } from "crypto";
import postgres from "postgres";
import { saveAvatar, signAvatar } from "../../lib/avatar";

export const runtime = "nodejs";

const sql = postgres(process.env.DB_URL ?? "");

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const userId = String(formData.get("userId") ?? "");
    const bio = String(formData.get("bio") ?? "").trim().slice(0, 160);
    const fileValue = formData.get("avatar");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

    if (!userId) return Response.json({ error: "A user is required." }, { status: 400 });
    if (file && !file.type.startsWith("image/")) return Response.json({ error: "Choose an image file." }, { status: 400 });
    if (file && file.size > 5 * 1024 * 1024) return Response.json({ error: "Profile pictures must be smaller than 5 MB." }, { status: 413 });

    const avatarKey = file ? `avatars/${userId}/${randomUUID()}` : null;
    if (file && avatarKey) await saveAvatar(avatarKey, file);

    const [user] = await sql`
      UPDATE chat_users
      SET bio = ${bio}, pfp = COALESCE(${avatarKey}, pfp)
      WHERE id = ${userId}::uuid
      RETURNING id, username, college_roll AS roll, bio, pfp
    `;
    if (!user) return Response.json({ error: "Could not find that user." }, { status: 404 });

    return Response.json({ user: { ...user, pfp: await signAvatar(user.pfp) } });
  } catch (error) {
    console.error("Profile update failed", error);
    return Response.json({ error: "Could not save your profile." }, { status: 500 });
  }
}