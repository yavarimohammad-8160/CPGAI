import { AsyncLocalStorage } from "node:async_hooks";
import db, { nowIso, uid } from "@/lib/db";
import { findUser, readUsers, resolveUserLimits } from "@/lib/users";

export type UsageKind = "chat" | "image" | "file" | "search";
export type UsageRange = "today" | "7d" | "30d";

type UsageBag = {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  model: string;
  search: boolean;
};

const store = new AsyncLocalStorage<UsageBag>();

function emptyBag(): UsageBag {
  return { tokensIn: 0, tokensOut: 0, cost: 0, model: "", search: false };
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeModel(value: string) {
  const m = String(value || "").trim().slice(0, 80);
  if (!m) return "";
  if (/sk-|api[_-]?key|bearer\s|authorization/i.test(m)) return "";
  return m;
}

function safeMeta(value: string) {
  const t = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (/sk-|api[_-]?key|bearer\s|authorization/i.test(t)) return "";
  return t;
}

export function parseModelUsage(data: unknown) {
  const row =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const usage =
    row.usage && typeof row.usage === "object"
      ? (row.usage as Record<string, unknown>)
      : {};
  const tokensIn = Math.round(
    num(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens)
  );
  const tokensOut = Math.round(
    num(
      usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens
    )
  );
  const costRaw = usage.cost ?? usage.total_cost ?? row.cost;
  const cost =
    typeof costRaw === "number" && Number.isFinite(costRaw) && costRaw > 0
      ? costRaw
      : num(costRaw);
  const model = safeModel(typeof row.model === "string" ? row.model : "");
  return { tokensIn, tokensOut, cost, model };
}

export function noteModelUsage(data: unknown, model = "") {
  const bag = store.getStore();
  if (!bag) return;
  const parsed = parseModelUsage(data);
  bag.tokensIn += parsed.tokensIn;
  bag.tokensOut += parsed.tokensOut;
  if (parsed.cost > 0) bag.cost += parsed.cost;
  const nextModel = safeModel(model) || parsed.model;
  if (nextModel) bag.model = nextModel;
}

export function noteSearchUsed() {
  const bag = store.getStore();
  if (bag) bag.search = true;
}

export function peekUsage() {
  return store.getStore() || emptyBag();
}

export function runUsage<T>(fn: () => Promise<T>) {
  return store.run(emptyBag(), fn);
}

export function recordUsageEvent(opts: {
  username: string;
  kind: UsageKind;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  meta?: string;
}) {
  const username = String(opts.username || "").trim().toLowerCase();
  if (!username) return;
  db.prepare(
    `INSERT INTO usage_events
      (id, username, kind, model, tokens_in, tokens_out, cost, created_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid(),
    username,
    opts.kind,
    safeModel(opts.model || ""),
    Math.max(0, Math.round(opts.tokensIn || 0)),
    Math.max(0, Math.round(opts.tokensOut || 0)),
    opts.cost && opts.cost > 0 ? opts.cost : 0,
    nowIso(),
    safeMeta(opts.meta || "")
  );
}

function fileMeta(file: { name?: string; mime?: string; url?: string }) {
  const hay = [file.name, file.mime, file.url].join(" ").toLowerCase();
  if (/pptx|presentation/.test(hay)) return "pptx";
  if (/xlsx|spreadsheet|excel/.test(hay)) return "xlsx";
  if (/pdf/.test(hay)) return "pdf";
  if (/docx|wordprocessing|msword/.test(hay)) return "docx";
  return "file";
}

const FAIL_TEXT =
  /انجام نشد|تنظیم نشده|پردازش پیام انجام نشد|زمان ساخت|خطای سرور|کلید .+ برای/;

export function logUsageIfSuccess(username: string, payload: unknown) {
  const user = String(username || "").trim();
  if (!user) return;
  if (!payload || typeof payload !== "object") return;
  const row = payload as Record<string, unknown>;
  if (row.error) return;
  const bag = peekUsage();
  const file =
    row.file && typeof row.file === "object"
      ? (row.file as { name?: string; mime?: string; url?: string })
      : null;
  const images = Array.isArray(row.images)
    ? row.images.filter((src) => typeof src === "string" && src)
    : [];
  if (typeof row.image === "string" && row.image && !images.includes(row.image)) {
    images.unshift(row.image);
  }
  const text = String(row.text || "");

  if (file?.url) {
    recordUsageEvent({
      username: user,
      kind: "file",
      model: bag.model,
      tokensIn: bag.tokensIn,
      tokensOut: bag.tokensOut,
      cost: bag.cost,
      meta: fileMeta(file),
    });
    return;
  }

  if (images.length) {
    images.forEach((_, i) => {
      recordUsageEvent({
        username: user,
        kind: "image",
        model: bag.model || "gpt-image-2",
        tokensIn: i === 0 ? bag.tokensIn : 0,
        tokensOut: i === 0 ? bag.tokensOut : 0,
        cost: i === 0 ? bag.cost : 0,
        meta: images.length > 1 ? String(images.length) : "",
      });
    });
    return;
  }

  if (!text || FAIL_TEXT.test(text)) return;

  recordUsageEvent({
    username: user,
    kind: "chat",
    model: bag.model,
    tokensIn: bag.tokensIn,
    tokensOut: bag.tokensOut,
    cost: bag.cost,
  });
  if (bag.search) {
    recordUsageEvent({
      username: user,
      kind: "search",
      model: bag.model,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    });
  }
}

export function monthStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function monthlyUsage(username: string) {
  const user = String(username || "").trim().toLowerCase();
  if (!user) return { tokens: 0, images: 0, files: 0 };
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
         SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) AS images,
         SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files
       FROM usage_events
       WHERE lower(username) = ? AND created_at >= ?`
    )
    .get(user, monthStartIso()) as {
    tokens: number | null;
    images: number | null;
    files: number | null;
  };
  return {
    tokens: row.tokens || 0,
    images: row.images || 0,
    files: row.files || 0,
  };
}

export function monthlyUsageByUser() {
  const rows = db
    .prepare(
      `SELECT
         lower(username) AS username,
         COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
         SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) AS images,
         SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files,
         MAX(created_at) AS last_at
       FROM usage_events
       WHERE created_at >= ?
       GROUP BY lower(username)`
    )
    .all(monthStartIso()) as Array<{
    username: string;
    tokens: number;
    images: number;
    files: number;
    last_at: string;
  }>;
  return new Map(rows.map((row) => [row.username, row]));
}

export type QuotaInfo = {
  used: { tokens: number; images: number; files: number };
  limits: { enabled: boolean; tokens: number; images: number; files: number };
};

export async function getQuota(username: string): Promise<QuotaInfo> {
  const users = await readUsers();
  const account = findUser(users, username);
  return {
    used: monthlyUsage(username),
    limits: resolveUserLimits(account),
  };
}

export function quotaMessage(
  kind: "image" | "file" | "chat",
  quota: QuotaInfo,
  extra = 1
) {
  if (!quota.limits.enabled) return null;
  const add = Math.max(1, extra);
  if (kind === "image") {
    if (
      quota.used.images >= quota.limits.images ||
      quota.used.images + add > quota.limits.images
    ) {
      return "سقف ماهانه ساخت تصویر شما تمام شده است. به ادمین مراجعه کنید.";
    }
    return null;
  }
  if (kind === "file") {
    if (
      quota.used.files >= quota.limits.files ||
      quota.used.files + add > quota.limits.files
    ) {
      return "سقف ماهانه ساخت فایل شما تمام شده است. به ادمین مراجعه کنید.";
    }
    return null;
  }
  if (quota.used.tokens >= quota.limits.tokens) {
    return "سقف ماهانه توکن شما تمام شده است. به ادمین مراجعه کنید.";
  }
  return null;
}

export function usageRangeStart(range: UsageRange) {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = range === "30d" ? 30 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function summarizeUsage(range: UsageRange) {
  const since = usageRangeStart(range);
  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN kind = 'chat' THEN 1 ELSE 0 END) AS chats,
         SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) AS images,
         SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files,
         SUM(CASE WHEN kind = 'search' THEN 1 ELSE 0 END) AS searches,
         SUM(tokens_in) AS tokens_in,
         SUM(tokens_out) AS tokens_out,
         SUM(cost) AS cost
       FROM usage_events
       WHERE created_at >= ?`
    )
    .get(since) as {
    chats: number | null;
    images: number | null;
    files: number | null;
    searches: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    cost: number | null;
  };
  const users = db
    .prepare(
      `SELECT
         lower(username) AS username,
         SUM(CASE WHEN kind = 'chat' THEN 1 ELSE 0 END) AS chats,
         SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) AS images,
         SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files,
         SUM(CASE WHEN kind = 'search' THEN 1 ELSE 0 END) AS searches,
         SUM(tokens_in) AS tokens_in,
         SUM(tokens_out) AS tokens_out,
         SUM(cost) AS cost,
         MAX(created_at) AS last_at
       FROM usage_events
       WHERE created_at >= ?
       GROUP BY lower(username)
       ORDER BY
         (SUM(tokens_in) + SUM(tokens_out)) DESC,
         (SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) + SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) + SUM(CASE WHEN kind = 'chat' THEN 1 ELSE 0 END)) DESC,
         MAX(created_at) DESC`
    )
    .all(since) as Array<{
    username: string;
    chats: number;
    images: number;
    files: number;
    searches: number;
    tokens_in: number;
    tokens_out: number;
    cost: number;
    last_at: string;
  }>;
  return {
    summary: {
      chats: totals.chats || 0,
      images: totals.images || 0,
      files: totals.files || 0,
      searches: totals.searches || 0,
      tokens: (totals.tokens_in || 0) + (totals.tokens_out || 0),
      tokensIn: totals.tokens_in || 0,
      tokensOut: totals.tokens_out || 0,
      cost: totals.cost || 0,
    },
    users,
  };
}
