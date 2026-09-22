import { NextRequest, NextResponse } from "next/server";
import { loadEnvConfig } from "@next/env";
import { readSteelStats, steelStatsRefreshDue } from "@/lib/steel-stats";
import {
  readSteelStatsLog,
  refreshSteelStats,
} from "@/lib/steel-stats-refresh";

loadEnvConfig(process.cwd());

export const runtime = "nodejs";
export const maxDuration = 180;

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
    const log = await readSteelStatsLog();
    return NextResponse.json({
      due: steelStatsRefreshDue(stats),
      updatedAt: stats.updatedAt,
      lastRefreshAt: stats.lastRefreshAt || "",
      lastRun: log.runs[0] || null,
    });
  } catch {
    return NextResponse.json({ error: "خواندن وضعیت بانک آمار ممکن نشد." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return forbidden();
  try {
    const body = (await req.json().catch(() => ({}))) as { source?: string };
    const result = await refreshSteelStats({
      by: body.source === "script" ? "script" : "admin-api",
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "به‌روزرسانی انجام نشد.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
