import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  deleteUser,
  publicUsers,
  readUsers,
  setUserActive,
  setUserLimits,
  setUserPassword,
  type UserRole,
} from "@/lib/users";

export const runtime = "nodejs";

function requireAdmin(req: NextRequest) {
  return req.headers.get("x-cpgai-role") === "admin";
}

function forbidden() {
  return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 403 });
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();

  try {
    const users = await readUsers();
    return NextResponse.json({ users: publicUsers(users) });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();

  try {
    const body = await req.json();
    const result = await createUser({
      username: String(body.username || ""),
      password: String(body.password || ""),
      name: String(body.name || ""),
      role: (body.role === "admin" ? "admin" : "user") as UserRole,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ user: result.user });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();

  try {
    const body = await req.json();
    const id = String(body.id || "");
    if (!id) {
      return NextResponse.json({ error: "شناسه کاربر لازم است." }, { status: 400 });
    }

    if (typeof body.active === "boolean") {
      const result = await setUserActive(id, body.active);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ user: result.user });
    }

    if (typeof body.password === "string") {
      const result = await setUserPassword(id, body.password);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ user: result.user });
    }

    if (
      body.monthly_token_limit !== undefined ||
      body.monthly_image_limit !== undefined ||
      body.monthly_file_limit !== undefined ||
      body.limits_enabled !== undefined
    ) {
      const result = await setUserLimits(id, body);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ user: result.user });
    }

    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || req.nextUrl.searchParams.get("id") || "");
    if (!id) {
      return NextResponse.json({ error: "شناسه کاربر لازم است." }, { status: 400 });
    }

    const result = await deleteUser(id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}
