import { NextRequest, NextResponse } from "next/server";
import {
  beginTwoFactorSetup,
  canonUsername,
  confirmTwoFactor,
  disableTwoFactor,
  twoFactorStatus,
} from "@/lib/users";

export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 403 });
}

function currentAdminUsername(req: NextRequest) {
  if (req.headers.get("x-cpgai-role") !== "admin") return "";
  return canonUsername(req.headers.get("x-cpgai-user") || "");
}

export async function GET(req: NextRequest) {
  const username = currentAdminUsername(req);
  if (!username) return forbidden();

  try {
    const result = await twoFactorStatus(username);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    return NextResponse.json({ enabled: result.enabled });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const username = currentAdminUsername(req);
  if (!username) return forbidden();

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const code = String(body.code || "");

    if (action === "setup") {
      const result = await beginTwoFactorSetup(username);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        qrDataUrl: result.qrDataUrl,
        secret: result.secret,
      });
    }

    if (action === "enable") {
      const result = await confirmTwoFactor(username, code);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, enabled: true });
    }

    if (action === "disable") {
      const result = await disableTwoFactor(username, code);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, enabled: false });
    }

    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}
