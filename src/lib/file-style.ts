import { userAskOnly } from "@/lib/text-to-slides";

/** Who the deliverable is for — drives branding, chrome, and prompts. */
export type DocAudience = "org" | "public";

const FA = (s: string) =>
  String(s || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");

const ORG_CUE =
  /سازمانی|سازمان(?:ی)?|شرکت(?:ی)?|سربرگ|نامه\s*رسمی|داخلی\s*شرکت|برای\s*(?:شرکت|سازمان)|سی[\u200c\s]*پی[\u200c\s]*جی|سی\s*پی\s*جی|cpg\s*pars|cpgpars|cpgai\s*سازمانی|برند\s*شرکت|لوگوی?\s*شرکت|محرمانه|هیئت\s*مدیره|مدیرعامل|واحد\s*سازمانی/i;

const PUBLIC_CUE =
  /عمومی|شخصی|بازار\s*کار|لینکدین|linkedin|بدون\s*(?:برند|لوگو|سربرگ)|غیر\s*سازمانی|برای\s*(?:سایت|وب|مشتری\s*خارجی)|freelance|freelancer/i;

const ORG_BRAND =
  /سی‌پی‌جی\s*پارس|سی پی جی\s*پارس|CPG\s*Pars|سند سازمانی(?:\s*CPGAI)?|گزارش سازمانی(?:\s*CPGAI)?|CPGAI سازمانی/gi;

/**
 * Decide org vs public from the user ask (and optional source).
 * Explicit cues win; otherwise infer from document type hints.
 */
export function detectDocAudience(ask: string, source = ""): DocAudience {
  const t = FA(userAskOnly(ask) || ask);
  const blob = t + "\n" + FA(source).slice(0, 800);
  if (PUBLIC_CUE.test(t)) return "public";
  if (ORG_CUE.test(blob)) return "org";
  // Resumes / open-market CVs default public unless org was asked
  if (/\b(cv|resume)\b|رزومه|بازار\s*کار/i.test(t) && !ORG_CUE.test(t)) {
    return "public";
  }
  // Training / lesson packs default public unless org/company asked
  if (/جزوه|handbook|courseware|دوره\s*آموزش/i.test(t) && !ORG_CUE.test(t)) {
    return "public";
  }
  // Performance, job profiles, charters, contracts → org by default for CPGAI
  if (
    /گزارش\s*عملکرد|شناسنامه\s*شغلی|شناسنامه\s*پروژه|منشور\s*پروژه|خلاصه\s*مدیریتی|قرارداد|پروپوزال|نامه/i.test(
      t
    )
  ) {
    return "org";
  }
  return "public";
}

export function stripOrgBrandText(text: string) {
  return String(text || "")
    .replace(ORG_BRAND, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Only strip company brand when the deliverable is meant to be public. */
export function applyAudienceBrand(text: string, audience: DocAudience) {
  if (audience === "org") return String(text || "").trim();
  return stripOrgBrandText(text);
}

/**
 * Pull an explicit file title/name from the user ask, e.g.
 * "با نام گزارش فروش Q1" / "نام فایل: قرارداد خدمات"
 */
export function extractExplicitFileName(ask: string): string {
  const t = FA(userAskOnly(ask) || ask);
  const patterns = [
    /(?:نام\s*فایل|اسم\s*فایل|عنوان\s*فایل|filename|file\s*name|save\s*as)\s*[:：=\-]?\s*[«"']?([^\n«»"']{2,80})/i,
    /با\s*نام\s*[«"']?([^\n«»"']{2,80})/,
    /تحت\s*عنوان\s*[«"']?([^\n«»"']{2,80})/,
    /عنوان\s*[:：]\s*[«"']?([^\n«»"']{2,80})/,
    /[«」]([^»」]{2,70})[»」]/,
    /"([^"]{2,70})"/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    let raw = String(m[1] || "").trim();
    raw = raw
      .replace(
        /\.(docx|pdf|pptx|xlsx)\b/gi,
        ""
      )
      .replace(
        /(?:لطفا|خواهشا|بساز|بده|کن|آماده|خروجی|فایل|ورد|word|پاورپوینت|pptx|pdf).*$/i,
        ""
      )
      .trim();
    if (raw.length >= 2) return raw.slice(0, 72);
  }
  return "";
}

export function sanitizeFancyFileName(name: string) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/[()[\]{}]+/g, " ")
    .replace(/[.,;،؛]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return cleaned || "سند";
}

const TYPE_PREFIX: Record<string, string> = {
  resume: "رزومه",
  job_profile: "شناسنامه-شغلی",
  project_charter: "شناسنامه-پروژه",
  training: "جزوه-آموزشی",
  translation: "ترجمه",
  presentation: "ارائه",
  brief: "خلاصه-مدیریتی",
  performance: "گزارش-عملکرد",
  from_source: "",
  chat: "",
  image: "",
};

/**
 * Build a professional download name from type + topic + audience.
 */
export function buildSmartFileName(opts: {
  type: string;
  format: string;
  topic: string;
  audience: DocAudience;
  explicitName?: string;
}) {
  const ext =
    opts.format === "pptx"
      ? ".pptx"
      : opts.format === "pdf"
        ? ".pdf"
        : opts.format === "xlsx"
          ? ".xlsx"
          : ".docx";

  if (opts.explicitName) {
    const base = sanitizeFancyFileName(opts.explicitName);
    return base.toLowerCase().endsWith(ext) ? base : base + ext;
  }

  const prefix = TYPE_PREFIX[opts.type] || "";
  let slug = sanitizeFancyFileName(opts.topic || "");
  const tokenCount = slug.split("-").filter(Boolean).length;
  if (!slug || slug === "سند") slug = prefix || "سند";
  if (prefix && slug.startsWith(prefix)) {
    return slug + ext;
  }
  // Real topic of 2+ words is the filename; don't pad with type/brand filler.
  if (tokenCount >= 2) {
    return slug + ext;
  }
  const base = prefix ? prefix + (slug && slug !== prefix ? "-" + slug : "") : slug;
  return sanitizeFancyFileName(base) + ext;
}

/** Short chrome strings for headers/footers. */
export function audienceChrome(audience: DocAudience, ltr = false) {
  if (audience === "org") {
    return {
      brand: ltr ? "CPG Pars" : "سی‌پی‌جی پارس",
      footer: ltr
        ? "CPG Pars — Confidential"
        : "سی‌پی‌جی پارس — محرمانه سازمانی",
      subtitle: ltr ? "Organizational document" : "سند سازمانی",
      accent: "C9A227", // soft gold
      navy: "0F2744",
      ink: "1C2E44",
      wash: "F7F4EA",
    };
  }
  return {
    brand: "CPGAI",
    footer: ltr ? "Prepared with CPGAI" : "تهیه‌شده با CPGAI",
    subtitle: ltr ? "Professional document" : "سند حرفه‌ای",
    accent: "2A9D8F", // teal
    navy: "1B263B",
    ink: "1C2E44",
    wash: "F4F7FB",
  };
}

/** Extra system-prompt lines for the LLM that drafts the body. */
export function audiencePromptLines(audience: DocAudience): string[] {
  if (audience === "org") {
    return [
      "این یک سند سازمانی برای سی‌پی‌جی پارس (CPG Pars) است.",
      "لحن رسمی سازمانی فارسی باشد؛ خطاب حرفه‌ای و دقیق.",
      "در عنوان یا سربرگ می‌توانی نام «سی‌پی‌جی پارس» را بیاوری وقتی با موضوع می‌خواند.",
      "عدد و ادعای ساختگی درباره عملکرد شرکت نساز مگر در منبع/درخواست باشد.",
      "ساختار سند باید شبیه خروجی دپارتمان استراتژی/منابع انسانی/کنترل پروژه یک شرکت صنعتی باشد: تیترهای واضح، بخش‌بندی مرتب، جدول در صورت نیاز.",
    ];
  }
  return [
    "این یک سند عمومی/غیرسازمانی است؛ برند سی‌پی‌جی پارس را داخل متن نگذار مگر کاربر صریحاً خواسته باشد.",
    "ظاهر و لحن حرفه‌ای و تمیز باشد، بدون سربرگ سازمانی تحمیلی.",
    "محتوا دقیقاً همان چیزی باشد که کاربر خواسته؛ قالب کلیشه‌ای عملکرد سالانه نساز.",
  ];
}
