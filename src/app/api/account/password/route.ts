import { NextRequest, NextResponse } from "next/server";
import { canonUsername, changeOwnPassword } from "@/lib/users";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const username = canonUsername(req.headers.get("x-cpgai-user") || "");
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const result = await changeOwnPassword(
      username,
      String(body.currentPassword || ""),
      String(body.newPassword || ""),
      String(body.confirmPassword || "")
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, text: "رمز تغییر کرد." });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}
