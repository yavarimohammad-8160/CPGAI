import { NextRequest, NextResponse } from "next/server";
import db, { nowIso, uid } from "@/lib/db";
import { persistMessageMedia } from "@/lib/media-store";
import { canonUsername } from "@/lib/users";

type Body = {
  username?: string;
  conversationId?: string;
  title?: string;
  pinned?: boolean;
  messages?: Array<{
    role?: string;
    content?: string;
    image?: string;
    images?: string[];
    fileName?: string;
    fileUrl?: string;
  }>;
};

function userOf(req: NextRequest, body?: Body) {
  return canonUsername(
    body?.username || req.headers.get("x-cpgai-user") || ""
  );
}

export async function GET(req: NextRequest) {
  const username = userOf(req);
  const conversationId = req.nextUrl.searchParams.get("id") || "";
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }

  if (conversationId) {
    const conv = db
      .prepare(
        "SELECT * FROM conversations WHERE id = ? AND lower(username) = ?"
      )
      .get(conversationId, username) as Record<string, unknown> | undefined;
    if (!conv) {
      return NextResponse.json({ error: "گفتگو پیدا نشد." }, { status: 404 });
    }
    const messages = db
      .prepare(
        "SELECT role, content, image, images, file_name as fileName, file_url as fileUrl FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
      )
      .all(conversationId);
    return NextResponse.json({ conversation: conv, messages });
  }

  const list = db
    .prepare(
      `SELECT id, title, pinned, created_at, updated_at
       FROM conversations
       WHERE lower(username) = ?
       ORDER BY pinned DESC, updated_at DESC`
    )
    .all(username);
  return NextResponse.json({ conversations: list });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const username = userOf(req, body);
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }

  const id = uid();
  const ts = nowIso();
  const title = (body.title || "گفتگوی جدید").slice(0, 80);

  db.prepare(
    `INSERT INTO conversations (id, username, title, pinned, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run(id, username, title, ts, ts);

  return NextResponse.json({ id, title });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const username = userOf(req, body);
  const conversationId = body.conversationId || "";
  if (!username || !conversationId) {
    return NextResponse.json({ error: "اطلاعات ناقص است." }, { status: 400 });
  }

  const conv = db
    .prepare("SELECT id FROM conversations WHERE id = ? AND lower(username) = ?")
    .get(conversationId, username);
  if (!conv) {
    return NextResponse.json({ error: "گفتگو پیدا نشد." }, { status: 404 });
  }

  const ts = nowIso();

  if (typeof body.title === "string") {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
    ).run(body.title.slice(0, 80), ts, conversationId);
  }

  if (typeof body.pinned === "boolean") {
    db.prepare(
      "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?"
    ).run(body.pinned ? 1 : 0, ts, conversationId);
  }

  if (Array.isArray(body.messages)) {
    if (body.messages.length === 0) {
      const existing = db
        .prepare(
          "SELECT COUNT(1) AS c FROM messages WHERE conversation_id = ?"
        )
        .get(conversationId) as { c: number };
      if ((existing?.c || 0) > 0) {
        console.log("HIST_SKIP_EMPTY", { id: conversationId, count: 0 });
        return NextResponse.json({ ok: true, skipped: "empty" });
      }
    }
    const prepared: Array<{
      role: string;
      content: string;
      image: string;
      images: string;
      fileName: string;
      fileUrl: string;
    }> = [];
    for (const msg of body.messages) {
      const media = await persistMessageMedia(msg);
      prepared.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content || "",
        image: media.image || "",
        images: JSON.stringify(media.images || []),
        fileName: media.fileName || msg.fileName || "",
        fileUrl: media.fileUrl || "",
      });
    }
    const insert = db.prepare(
      `INSERT INTO messages
       (id, conversation_id, role, content, image, images, file_name, file_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const wipe = db.prepare("DELETE FROM messages WHERE conversation_id = ?");
    const tx = db.transaction(() => {
      wipe.run(conversationId);
      for (const msg of prepared) {
        insert.run(
          uid(),
          conversationId,
          msg.role,
          msg.content,
          msg.image || null,
          msg.images || null,
          msg.fileName || null,
          msg.fileUrl || null,
          nowIso()
        );
      }
      db.prepare(
        "UPDATE conversations SET updated_at = ?, title = CASE WHEN title = 'گفتگوی جدید' AND ? != '' THEN ? ELSE title END WHERE id = ?"
      ).run(
        ts,
        (body.messages?.[0]?.content || "").slice(0, 40),
        (body.messages?.[0]?.content || "گفتگوی جدید").slice(0, 40),
        conversationId
      );
    });
    tx();
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const username = userOf(req);
  const conversationId = req.nextUrl.searchParams.get("id") || "";
  if (!username || !conversationId) {
    return NextResponse.json({ error: "اطلاعات ناقص است." }, { status: 400 });
  }
  db.prepare(
    "DELETE FROM messages WHERE conversation_id = ?"
  ).run(conversationId);
  const info = db
    .prepare("DELETE FROM conversations WHERE id = ? AND lower(username) = ?")
    .run(conversationId, username);
  return NextResponse.json({ ok: info.changes > 0 });
}