import { NextRequest, NextResponse } from "next/server";
import { authenticate, canonUsername } from "@/lib/users";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = canonUsername(String(body.username || ""));
    const password = String(body.password || "");
    const code =
      body.code == null || body.code === ""
        ? undefined
        : String(body.code);

    const result = await authenticate(username, password, code);
    if ("needs2FA" in result) {
      return NextResponse.json({ needs2FA: true });
    }
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    return NextResponse.json({
      username: canonUsername(result.user.username),
      role: result.user.role,
      name: result.user.name,
    });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}
