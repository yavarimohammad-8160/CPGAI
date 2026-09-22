import { NextRequest, NextResponse } from "next/server";
import {
  addMemory,
  deleteMemory,
  listMemories,
  type MemoryScope,
  type MemoryTopic,
} from "@/lib/memory";
import { canonUsername } from "@/lib/users";

export const runtime = "nodejs";

function userOf(req: NextRequest, body?: { username?: string }) {
  return canonUsername(
    body?.username || req.headers.get("x-cpgai-user") || ""
  );
}

function isAdmin(req: NextRequest) {
  return req.headers.get("x-cpgai-role") === "admin";
}

export async function GET(req: NextRequest) {
  const username = userOf(req);
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  const orgOnly = req.nextUrl.searchParams.get("scope") === "org";
  if (orgOnly && !isAdmin(req)) {
    return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 403 });
  }
  const memories = listMemories(username, { orgOnly: orgOnly && isAdmin(req) });
  return NextResponse.json({ memories });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    content?: string;
    scope?: MemoryScope;
    topic?: MemoryTopic;
  };
  const username = userOf(req, body);
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  const action = String(
    (body as { action?: string }).action || ""
  ).toLowerCase();
  if (action === "delete") {
    const id = String((body as { id?: string }).id || "");
    if (!id) {
      return NextResponse.json({ error: "شناسه لازم است." }, { status: 400 });
    }
    const result = deleteMemory(id, username, isAdmin(req));
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }
  const scope = body.scope === "org" ? "org" : "user";
  if (scope === "org" && !isAdmin(req)) {
    return NextResponse.json({ error: "حافظه سازمانی فقط توسط ادمین ساخته می‌شود." }, { status: 403 });
  }
  const saved = addMemory({
    username,
    scope,
    topic: body.topic,
    content: String(body.content || ""),
  });
  if ("error" in saved) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }
  return NextResponse.json({ memory: saved.memory });
}

export async function DELETE(req: NextRequest) {
  const username = userOf(req);
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  const id =
    req.nextUrl.searchParams.get("id") ||
    String(((await req.json().catch(() => ({}))) as { id?: string }).id || "");
  if (!id) {
    return NextResponse.json({ error: "شناسه لازم است." }, { status: 400 });
  }
  const result = deleteMemory(id, username, isAdmin(req));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
