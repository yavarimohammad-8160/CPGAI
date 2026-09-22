import { readFile, writeFile } from "fs/promises";
import path from "path";
import { getAvalaiClient } from "@/lib/llm";
import {
  PRODUCT_LABEL,
  readSteelStats,
  steelStatsRefreshDue,
  type ProductKey,
  type StatPoint,
  type SteelStats,
} from "@/lib/steel-stats";
import { searchWeb, type ExtractedStat, type WebHit } from "@/lib/web-search";

export type StatsChange = {
  company: string;
  product: ProductKey;
  year: string;
  from: number | null;
  to: number | null;
  source: string;
  action: "fill-null" | "add-year" | "update-sourced" | "skip";
  reason: string;
};

export type RefreshRun = {
  at: string;
  by: "admin-api" | "script";
  due: boolean;
  searched: number;
  applied: StatsChange[];
  skipped: StatsChange[];
  note: string;
};

export type RefreshResult = {
  ok: boolean;
  updatedAt: string;
  lastRefreshAt: string;
  due: boolean;
  searched: number;
  applied: StatsChange[];
  skipped: StatsChange[];
  reminder?: string;
  note: string;
};

const LOG_PATH = path.join(process.cwd(), "data", "steel-stats-log.json");
const STATS_PATH = path.join(process.cwd(), "data", "steel-stats.json");
const PRODUCT_KEYS: ProductKey[] = ["concentrate", "pellet", "dri", "billet"];

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toEnDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (ch) => String(FA_DIGITS.indexOf(ch)))
    .replace(/[٬،]/g, ",");
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isTrustedSource(source: string) {
  const t = (source || "").toLowerCase();
  return /codal\.ir|کدال|گزارش عملکرد|گزارش فعالیت|گزارش رسمی|mimt\.gov|ime\.co|سالنامه/.test(
    t
  );
}

function isAcceptableSource(source: string) {
  if (isTrustedSource(source)) return true;
  return /معدن۲۴|donya-e-eqtesad|eghtesadonline|irna|isna|mehrnews|boursepress|shana/.test(
    (source || "").toLowerCase()
  );
}

export function parseProductionTons(raw: string): number | null {
  const original = String(raw || "");
  const t = toEnDigits(original).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const million = t.match(/([\d.]+)\s*میلیون/);
  if (million) {
    const n = Number(million[1]);
    if (!Number.isFinite(n)) return null;
    const extraMatch = t.match(/میلیون\s*و\s*([\d.]+)\s*هزار/);
    const extra = extraMatch ? Number(extraMatch[1]) * 1000 : 0;
    const tons = Math.round(n * 1_000_000 + extra);
    return tons >= 1000 && tons <= 80_000_000 ? tons : null;
  }

  if (/هزار/.test(t) && /تن/.test(original + t)) {
    const thousand = t.match(/([\d.]+)\s*هزار/);
    if (thousand) {
      const tons = Math.round(Number(thousand[1]) * 1000);
      return tons >= 1000 && tons <= 80_000_000 ? tons : null;
    }
  }

  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n >= 1000 && n <= 80_000_000) return Math.round(n);
  return null;
}

export function mergeStatPoints(
  current: StatPoint[] | undefined,
  incoming: StatPoint
): { points: StatPoint[]; change: StatsChange | null } {
  const points = Array.isArray(current) ? current.map((item) => ({ ...item })) : [];
  const next: StatPoint = {
    year: String(incoming.year || "").trim(),
    value: incoming.value ?? null,
    unit: incoming.unit || "ton",
    source: (incoming.source || "").trim(),
  };
  if (!next.year || next.value == null || !Number.isFinite(next.value)) {
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year || "—",
        from: null,
        to: next.value,
        source: next.source || "",
        action: "skip",
        reason: "رقم یا سال نامعتبر است",
      },
    };
  }
  if (!next.source || !isAcceptableSource(next.source)) {
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: null,
        to: next.value,
        source: next.source || "",
        action: "skip",
        reason: "منبع معتبر نیست",
      },
    };
  }

  const idx = points.findIndex((item) => item.year === next.year);
  if (idx < 0) {
    points.push(next);
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: null,
        to: next.value,
        source: next.source,
        action: "add-year",
        reason: "سال جدید با منبع معتبر اضافه شد",
      },
    };
  }

  const prev = points[idx];
  if (prev.value == null) {
    points[idx] = { ...prev, value: next.value, source: next.source, unit: next.unit };
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: null,
        to: next.value,
        source: next.source,
        action: "fill-null",
        reason: "جای خالی با رقم دارای منبع پر شد",
      },
    };
  }

  const prevVal = prev.value;
  const delta = Math.abs(prevVal - next.value) / Math.max(prevVal, 1);
  if (delta < 0.01) {
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: prevVal,
        to: next.value,
        source: next.source,
        action: "skip",
        reason: "رقم قبلی با اختلاف ناچیز باقی ماند",
      },
    };
  }
  if (!isTrustedSource(next.source)) {
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: prevVal,
        to: next.value,
        source: next.source,
        action: "skip",
        reason: "عدد قبلی بدون منبع معتبرتر خراب نمی‌شود",
      },
    };
  }
  if (delta > 2 && !/codal\.ir|کدال/.test(next.source.toLowerCase())) {
    return {
      points,
      change: {
        company: "",
        product: "billet",
        year: next.year,
        from: prevVal,
        to: next.value,
        source: next.source,
        action: "skip",
        reason: "اختلاف مشکوک با رقم قبلی؛ بدون کدال اعمال نشد",
      },
    };
  }

  points[idx] = { ...prev, value: next.value, source: next.source, unit: next.unit };
  return {
    points,
    change: {
      company: "",
      product: "billet",
      year: next.year,
      from: prevVal,
      to: next.value,
      source: next.source,
      action: "update-sourced",
      reason: "رقم قبلی با منبع معتبرتر جایگزین شد",
    },
  };
}

function sourceBlob(stat: ExtractedStat) {
  return [stat.sourceUrl, stat.sourceTitle, stat.raw].filter(Boolean).join(" | ");
}

function pickActualStat(stats: ExtractedStat[]) {
  return stats.find((item) => item.kind === "actual") || stats.find((item) => item.kind === "unknown");
}

async function readLog(): Promise<{ runs: RefreshRun[] }> {
  try {
    const raw = await readFile(LOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { runs?: RefreshRun[] };
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

async function writeLog(runs: RefreshRun[]) {
  await writeFile(LOG_PATH, JSON.stringify({ runs: runs.slice(0, 50) }, null, 2) + "\n", "utf8");
}

async function writeStats(stats: SteelStats) {
  await writeFile(STATS_PATH, JSON.stringify(stats, null, 2) + "\n", "utf8");
}

function nextYear(year: string) {
  const n = Number(toEnDigits(year));
  if (!Number.isFinite(n)) return "";
  return String(n + 1);
}

function refreshTargets(stats: SteelStats) {
  const targets: { company: string; product: ProductKey; year: string }[] = [];
  for (const company of stats.companies) {
    for (const product of PRODUCT_KEYS) {
      const points = company.products?.[product] || [];
      for (const point of points) {
        if (point.value == null) {
          targets.push({ company: company.name, product, year: point.year });
        }
      }
      const years = points
        .map((item) => item.year)
        .filter(Boolean)
        .sort();
      const last = years[years.length - 1];
      if (last) {
        const nxt = nextYear(last);
        if (nxt && !points.some((item) => item.year === nxt)) {
          targets.push({ company: company.name, product, year: nxt });
        }
      }
    }
  }
  return targets.slice(0, 10);
}

export async function refreshSteelStats(opts?: {
  by?: "admin-api" | "script";
  dryRun?: boolean;
}): Promise<RefreshResult> {
  const stats = await readSteelStats();
  const due = steelStatsRefreshDue(stats);
  const reminder = due
    ? "یادآوری ماهانه: بیش از ۳۰ روز از آخرین به‌روزرسانی بانک آمار گذشته است."
    : undefined;
  const avalai = getAvalaiClient();
  const by = opts?.by || "admin-api";
  const applied: StatsChange[] = [];
  const skipped: StatsChange[] = [];
  let searched = 0;

  if (!avalai) {
    const lastRefreshAt = new Date().toISOString();
    stats.lastRefreshAt = lastRefreshAt;
    if (!opts?.dryRun) {
      await writeStats(stats);
      const log = await readLog();
      log.runs.unshift({
        at: lastRefreshAt,
        by,
        due,
        searched: 0,
        applied: [],
        skipped: [],
        note: "کلید AvalAI برای جستجوی کدال موجود نبود. فقط یادآوری ثبت شد.",
      });
      await writeLog(log.runs);
    }
    return {
      ok: true,
      updatedAt: stats.updatedAt,
      lastRefreshAt,
      due,
      searched: 0,
      applied: [],
      skipped: [],
      reminder,
      note: "جستجو انجام نشد؛ کلید AvalAI تنظیم نشده است. بانک خراب نشد.",
    };
  }

  const targets = refreshTargets(stats);
  for (const target of targets) {
    searched += 1;
    const query =
      "تولید " +
      PRODUCT_LABEL[target.product] +
      " " +
      target.company +
      " " +
      target.year +
      " کدال تن";
    const found = await searchWeb(avalai.apiKey, query);
    if (!found.ok) {
      skipped.push({
        company: target.company,
        product: target.product,
        year: target.year,
        from: null,
        to: null,
        source: "",
        action: "skip",
        reason: found.error || "جستجو نتیجه‌ای نداشت",
      });
      continue;
    }

    const actualHits: ExtractedStat[] = found.stats.filter(
      (item) => item.kind !== "capacity" && item.kind !== "plan"
    );
    const picked = pickActualStat(actualHits);
    const extractedYear = picked?.year
      ? toEnDigits(picked.year).replace(/[^\d]/g, "")
      : "";
    if (extractedYear && extractedYear !== String(target.year)) {
      skipped.push({
        company: target.company,
        product: target.product,
        year: extractedYear,
        from: null,
        to: null,
        source: picked ? sourceBlob(picked) : "",
        action: "skip",
        reason: "سال اسنیپت با سال هدف یکی نیست؛ رقم به سال دیگر نسبت داده نشد",
      });
      continue;
    }
    const year = extractedYear || target.year;
    const value = picked ? parseProductionTons(picked.raw) : null;
    const source = picked ? sourceBlob(picked) : found.hits[0] ? hitSource(found.hits[0]) : "";

    if (value == null) {
      skipped.push({
        company: target.company,
        product: target.product,
        year,
        from: null,
        to: null,
        source,
        action: "skip",
        reason: "رقم تولید واقعی قابل اعتماد استخراج نشد",
      });
      continue;
    }

    const company = stats.companies.find((item) => item.name === target.company);
    if (!company) continue;
    if (!company.products) company.products = {};
    const merged = mergeStatPoints(company.products[target.product], {
      year,
      value,
      unit: "ton",
      source,
    });
    if (merged.change) {
      merged.change.company = target.company;
      merged.change.product = target.product;
      if (merged.change.action === "skip") skipped.push(merged.change);
      else applied.push(merged.change);
    }
    if (merged.change && merged.change.action !== "skip") {
      company.products[target.product] = merged.points;
    }
  }

  const lastRefreshAt = new Date().toISOString();
  stats.lastRefreshAt = lastRefreshAt;
  if (applied.length) stats.updatedAt = todayStamp();

  if (!opts?.dryRun) {
    await writeStats(stats);
    const log = await readLog();
    log.runs.unshift({
      at: lastRefreshAt,
      by,
      due,
      searched,
      applied,
      skipped,
      note: applied.length
        ? applied.length + " فیلد با منبع معتبر به‌روز شد."
        : "رقم جدیدی با منبع معتبر پیدا نشد. مقادیر قبلی حفظ شد.",
    });
    await writeLog(log.runs);
  }

  return {
    ok: true,
    updatedAt: stats.updatedAt,
    lastRefreshAt,
    due,
    searched,
    applied,
    skipped,
    reminder,
    note: applied.length
      ? applied.length + " مورد با منبع معتبر اعمال شد."
      : "بانک تغییر نکرد؛ عدد قبلی بدون منبع جدید خراب نشد.",
  };
}

function hitSource(hit: WebHit) {
  return [hit.url, hit.title].filter(Boolean).join(" | ");
}

export async function readSteelStatsLog() {
  return readLog();
}
