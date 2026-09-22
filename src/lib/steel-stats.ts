import { readFile, writeFile } from "fs/promises";
import path from "path";

export type StatPoint = {
  year: string;
  value: number | null;
  unit: string;
  source?: string;
};

export type CapacityPoint = {
  value: number | null;
  unit: string;
  note?: string;
};

export type ProductKey = "concentrate" | "pellet" | "dri" | "billet";

export type SteelCompany = {
  name: string;
  aliases?: string[];
  role?: string;
  products?: Partial<Record<ProductKey, StatPoint[]>>;
  capacity?: Partial<Record<ProductKey, CapacityPoint>>;
};

export type SteelStats = {
  updatedAt: string;
  lastRefreshAt?: string;
  notes?: string;
  companies: SteelCompany[];
  national?: Partial<Record<ProductKey, StatPoint[]>>;
};

export type CompareRow = {
  company: string;
  product: ProductKey;
  productLabel: string;
  year: string;
  value: number | null;
  unit: string;
  source: string;
  missing: boolean;
};

export type SteelCompareResult = {
  isCompare: boolean;
  rows: CompareRow[];
  table: string;
  ranking: string;
  missing: string[];
  complete: boolean;
  prompt: string;
};

const STATS_PATH = path.join(process.cwd(), "data", "steel-stats.json");

export const PRODUCT_LABEL: Record<ProductKey, string> = {
  concentrate: "کنسانتره",
  pellet: "گندله",
  dri: "آهن اسفنجی",
  billet: "شمش",
};

export async function readSteelStats(): Promise<SteelStats> {
  const raw = await readFile(STATS_PATH, "utf8");
  return JSON.parse(raw) as SteelStats;
}

export async function saveSteelStats(data: SteelStats) {
  if (!Array.isArray(data.companies)) {
    throw new Error("ساختار companies نامعتبر است.");
  }
  data.updatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(STATS_PATH, JSON.stringify(data, null, 2), "utf8");
  return data;
}

export function isSteelCompareAsk(text: string) {
  const t = text || "";
  return /مقایسه|تفاوت تولید|رتبه|بزرگ‌ترین|بزرگترین|بیشترین تولید|کمترین تولید|در مقابل|\bversus\b|\bvs\b|بین .{1,40} و /.test(
    t
  );
}

export function isSteelStatsAsk(text: string) {
  const t = text || "";
  const steel =
    /فولاد|معدن|چادرملو|کچاد|مبارکه|خوزستان|گل‌گهر|گل گهر|گندله|کنسانتره|آهن اسفنجی|شمش|ارفع|کاوه|صبا فولاد|خراسان|جهان فولاد|احیای مستقیم|\bDRI\b|کگل|فخوز/.test(
      t
    );
  return steel || (isSteelCompareAsk(t) && /شمش|گندله|کنسانتره|آهن اسفنجی|billet|pellet/.test(t));
}

export function steelStatsRefreshDue(stats: SteelStats) {
  const stamp = stats.lastRefreshAt || stats.updatedAt || "";
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) / 86400000 >= 30;
}

function detectProduct(text: string): ProductKey | null {
  if (/شمش|بیلت|billet/.test(text)) return "billet";
  if (/گندله|pellet/.test(text)) return "pellet";
  if (/کنسانتره|concentrate/.test(text)) return "concentrate";
  if (/آهن اسفنجی|احیای مستقیم|\bDRI\b|dri/.test(text)) return "dri";
  return null;
}

function norm(value: string) {
  return value.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").trim();
}

function matchCompanies(stats: SteelStats, text: string) {
  const t = norm(text);
  const hits = stats.companies.filter((company) => {
    const names = [company.name, ...(company.aliases || [])];
    return names.some((name) => t.includes(norm(name)));
  });
  return hits;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatUnit(unit: string) {
  if (unit === "ton") return "تن";
  if (unit === "ton/year") return "تن در سال";
  return unit;
}

function usablePoints(points?: StatPoint[]) {
  return (points || []).filter(
    (item) => item && item.value != null && Number.isFinite(item.value)
  );
}

export function formatSteelStatsContext(question: string, stats: SteelStats) {
  const compare = buildSteelComparison(question, stats);
  if (compare.isCompare) {
    return {
      prompt: compare.prompt,
      incomplete: false,
      foundValue: compare.rows.some((row) => !row.missing),
      compare: true,
      compareComplete: compare.complete,
    };
  }

  const product = detectProduct(question);
  const named = matchCompanies(stats, question);
  const companies =
    named.length
      ? named
      : product === "dri" || /پیشرو|چه شرکت|کدام‌اند|کدام اند/.test(question)
        ? stats.companies.filter(
            (company) =>
              /آهن اسفنجی|احیای مستقیم/.test(company.role || "") ||
              usablePoints(company.products?.dri).length > 0
          )
        : stats.companies;

  const lines: string[] = [
    "بانک آمار داخلی CPGAI",
    "updatedAt: " + (stats.updatedAt || ""),
    stats.notes || "",
    "دستور: اگر از این بانک رقم می‌آوری، در پاسخ بنویس «بر اساس بانک آمار داخلی CPGAI». رقم null را حدس نزن. ظرفیت را تولید واقعی ننام.",
  ];

  if (product === "dri" || /آهن اسفنجی|احیای مستقیم/.test(question)) {
    lines.push("شرکت‌های مرتبط آهن اسفنجی / احیای مستقیم در بانک داخلی:");
  }

  let foundValue = false;
  for (const company of companies) {
    lines.push("- شرکت: " + company.name);
    if (company.role) lines.push("  نقش: " + company.role);
    const keys: ProductKey[] = product ? [product] : ["billet", "dri", "pellet", "concentrate"];
    for (const key of keys) {
      const points = usablePoints(company.products?.[key]);
      for (const point of points) {
        foundValue = true;
        lines.push(
          "  تولید واقعی " +
            PRODUCT_LABEL[key] +
            " سال " +
            point.year +
            ": " +
            formatNumber(point.value as number) +
            " " +
            formatUnit(point.unit) +
            (point.source ? " | منبع: " + point.source : "")
        );
      }
      const cap = company.capacity?.[key];
      if (cap && cap.value != null) {
        lines.push(
          "  ظرفیت اسمی " +
            PRODUCT_LABEL[key] +
            ": " +
            formatNumber(cap.value) +
            " " +
            formatUnit(cap.unit) +
            (cap.note ? " | " + cap.note : "")
        );
      }
    }
  }

  const incomplete =
    !foundValue ||
    (product != null &&
      named.length > 0 &&
      named.some((company) => usablePoints(company.products?.[product]).length === 0));

  return {
    prompt: lines.filter(Boolean).join("\n"),
    incomplete,
    foundValue,
    compare: false,
    compareComplete: false,
  };
}

export function buildSteelComparison(
  question: string,
  stats: SteelStats
): SteelCompareResult {
  const empty: SteelCompareResult = {
    isCompare: false,
    rows: [],
    table: "",
    ranking: "",
    missing: [],
    complete: true,
    prompt: "",
  };
  if (!isSteelCompareAsk(question)) return empty;

  const product = detectProduct(question);
  let named = matchCompanies(stats, question);
  if (!named.length && product) {
    named = stats.companies.filter(
      (company) => usablePoints(company.products?.[product]).length > 0
    );
  }
  const products: ProductKey[] = product
    ? [product]
    : ["billet", "dri", "pellet", "concentrate"];
  const companies = named.length ? named : stats.companies;
  const rows: CompareRow[] = [];
  const missing: string[] = [];

  for (const company of companies) {
    for (const key of products) {
      const points = usablePoints(company.products?.[key]);
      if (!points.length) {
        if (product || named.length) {
          rows.push({
            company: company.name,
            product: key,
            productLabel: PRODUCT_LABEL[key],
            year: "—",
            value: null,
            unit: "ton",
            source: "در بانک داخلی موجود نیست",
            missing: true,
          });
          missing.push(company.name + " / " + PRODUCT_LABEL[key]);
        }
        continue;
      }
      for (const point of points) {
        rows.push({
          company: company.name,
          product: key,
          productLabel: PRODUCT_LABEL[key],
          year: point.year,
          value: point.value,
          unit: point.unit || "ton",
          source: point.source || "بانک آمار داخلی CPGAI",
          missing: false,
        });
      }
    }
  }

  const tableLines = [
    "شرکت | محصول | سال | مقدار | منبع",
    ...rows.map((row) => {
      const amount = row.missing
        ? "در بانک داخلی موجود نیست"
        : formatNumber(row.value as number) + " " + formatUnit(row.unit);
      return (
        row.company +
        " | " +
        row.productLabel +
        " | " +
        row.year +
        " | " +
        amount +
        " | " +
        row.source
      );
    }),
  ];

  const ranking = rankFromRows(question, rows);
  const complete = missing.length === 0 && rows.some((row) => !row.missing);
  const prompt = [
    "سؤال مقایسه/رتبه است. فقط از بانک داخلی جواب بده.",
    "حتماً جدول زیر را با همین ستون‌ها بیاور: شرکت | محصول | سال | مقدار | منبع",
    "ظرفیت اسمی را با تولید واقعی قاطی نکن و در این جدول نیاور.",
    "اگر مقدار نبود بنویس: در بانک داخلی موجود نیست. حدس نزن.",
    "بر اساس بانک آمار داخلی CPGAI",
    "updatedAt: " + (stats.updatedAt || ""),
    "",
    tableLines.join("\n"),
    ranking ? "\nنتیجه رتبه‌بندی بانک داخلی:\n" + ranking : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    isCompare: true,
    rows,
    table: tableLines.join("\n"),
    ranking,
    missing,
    complete,
    prompt,
  };
}

function rankFromRows(question: string, rows: CompareRow[]) {
  const numeric = rows.filter(
    (row) => !row.missing && row.value != null && Number.isFinite(row.value)
  );
  if (numeric.length < 2) return "";

  const wantMin = /کمترین|کوچک‌ترین|کوچکتر/.test(question);
  const wantRank =
    wantMin ||
    /بزرگ‌ترین|بزرگترین|بیشترین|رتبه|مقایسه|تفاوت/.test(question);
  if (!wantRank) return "";

  const byProduct = new Map<ProductKey, CompareRow[]>();
  for (const row of numeric) {
    const list = byProduct.get(row.product) || [];
    list.push(row);
    byProduct.set(row.product, list);
  }

  const lines: string[] = [];
  for (const [key, list] of byProduct) {
    const years = [...new Set(list.map((row) => row.year))].sort().reverse();
    let year = years[0];
    for (const candidate of years) {
      const names = new Set(
        list.filter((row) => row.year === candidate).map((row) => row.company)
      );
      if (names.size >= 2) {
        year = candidate;
        break;
      }
    }
    const subset = list
      .filter((row) => row.year === year)
      .sort((a, b) => (wantMin ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number)));
    if (!subset.length) continue;
    const top = subset[0];
    const rest = subset
      .slice(1)
      .map(
        (row) =>
          row.company +
          " " +
          formatNumber(row.value as number) +
          " " +
          formatUnit(row.unit)
      )
      .join("؛ ");
    lines.push(
      "سال " +
        year +
        " / " +
        PRODUCT_LABEL[key] +
        ": " +
        (wantMin ? "کمترین" : "بیشترین") +
        " تولید " +
        top.company +
        " با " +
        formatNumber(top.value as number) +
        " " +
        formatUnit(top.unit) +
        (rest ? ". سایر: " + rest : "") +
        "."
    );
  }
  return lines.join("\n");
}
