import { NextRequest, NextResponse } from "next/server";
import { canonUsername, readUsers, resolveUserLimits } from "@/lib/users";
import { monthlyUsageByUser, summarizeUsage, type UsageRange } from "@/lib/usage";

export const runtime = "nodejs";

function requireAdmin(req: NextRequest) {
  const role = req.headers.get("x-cpgai-role") === "admin";
  const user = String(req.headers.get("x-cpgai-user") || "").trim();
  return role && !!user;
}

function parseRange(value: string | null): UsageRange {
  if (value === "today" || value === "30d") return value;
  return "7d";
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 403 });
  }
  try {
    const range = parseRange(req.nextUrl.searchParams.get("range"));
    const packed = summarizeUsage(range);
    const users = await readUsers();
    const monthMap = monthlyUsageByUser();
    const names = new Map(
      users.map((row) => [canonUsername(row.username), row.name])
    );
    const seen = new Set<string>();
    const table = packed.users.map((row) => {
      seen.add(canonUsername(row.username));
      const account = users.find(
        (item) => canonUsername(item.username) === canonUsername(row.username)
      );
      const limits = resolveUserLimits(account);
      const month = monthMap.get(canonUsername(row.username));
      return {
        username: row.username,
        name: names.get(canonUsername(row.username)) || row.username,
        chats: row.chats || 0,
        images: row.images || 0,
        files: row.files || 0,
        searches: row.searches || 0,
        tokens: (row.tokens_in || 0) + (row.tokens_out || 0),
        cost: row.cost || 0,
        lastAt: row.last_at || "",
        monthTokens: month?.tokens || 0,
        monthImages: month?.images || 0,
        monthFiles: month?.files || 0,
        tokenLimit: limits.enabled ? limits.tokens : 0,
        imageLimit: limits.enabled ? limits.images : 0,
        fileLimit: limits.enabled ? limits.files : 0,
        limitsEnabled: limits.enabled,
      };
    });
    for (const account of users) {
      if (seen.has(canonUsername(account.username))) continue;
      const limits = resolveUserLimits(account);
      const month = monthMap.get(canonUsername(account.username));
      table.push({
        username: account.username,
        name: account.name,
        chats: 0,
        images: 0,
        files: 0,
        searches: 0,
        tokens: 0,
        cost: 0,
        lastAt: month?.last_at || "",
        monthTokens: month?.tokens || 0,
        monthImages: month?.images || 0,
        monthFiles: month?.files || 0,
        tokenLimit: limits.enabled ? limits.tokens : 0,
        imageLimit: limits.enabled ? limits.images : 0,
        fileLimit: limits.enabled ? limits.files : 0,
        limitsEnabled: limits.enabled,
      });
    }
    return NextResponse.json({
      range,
      summary: packed.summary,
      users: table,
    });
  } catch (err) {
    console.log("USAGE_ADMIN_ERROR", err);
    return NextResponse.json({ error: "خواندن مصرف ممکن نشد." }, { status: 500 });
  }
}
