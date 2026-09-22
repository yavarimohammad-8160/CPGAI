import { NextRequest, NextResponse } from "next/server";
import { readSteelStats, saveSteelStats, type SteelStats } from "@/lib/steel-stats";

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
    const stats = await readSteelStats();
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ error: "خواندن بانک آمار ممکن نشد." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();
  try {
    const body = await req.json();
    const stats = (body.stats || body) as SteelStats;
    const saved = await saveSteelStats(stats);
    return NextResponse.json({ stats: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ذخیره انجام نشد.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
