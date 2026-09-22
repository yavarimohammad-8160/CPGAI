import { readFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import ExcelJS from "exceljs";
import bidiFactory from "bidi-js";
import { PersianShaper } from "arabic-persian-reshaper";

const bidi = bidiFactory();

import {
  resolveIntent,
  intentOutputKind,
  wantsFileOutput,
  type DocumentIntent,
  type WorkType,
} from "@/lib/intent";
import {
  applyAudienceBrand,
  audienceChrome,
  audiencePromptLines,
  detectDocAudience,
  type DocAudience,
} from "@/lib/file-style";
import { blocksToPdfHtml, renderHtmlToPdfBuffer, sanitizePdfText } from "@/lib/pdf-chrome";
import { FA_DOC_FONT, adaptTextForBNazanin } from "@/lib/doc-font";


export type { DocumentIntent, WorkType };
export type FileKind = "word" | "pdf" | "pptx" | "xlsx";

export type BuiltFile = {
  fileName: string;
  fileBase64: string;
  fileMime: string;
};

const MIME: Record<FileKind, string> = {
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const NAVY = "0F2744";
const SOFT = "EEF3F8";
const FA_FONT = {
  ascii: "B Nazanin",
  hAnsi: "B Nazanin",
  cs: FA_DOC_FONT,
  eastAsia: "B Nazanin",
  hint: "cs",
};

type FkGlyph = { id: number; advanceWidth: number };
type FkFont = {
  layout: (text: string, features?: unknown) => { glyphs: FkGlyph[] };
  unitsPerEm: number;
};

function cleanLine(line: string) {
  return adaptTextForBNazanin(
    line
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`/g, "")
      .trim()
  );
}

function countWords(text: string) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function faRun(
  text: string,
  extra?: { bold?: boolean; size?: number; color?: string }
) {
  return new TextRun({
    text,
    font: FA_FONT,
    rightToLeft: true,
    bold: extra?.bold,
    boldComplexScript: extra?.bold,
    size: extra?.size,
    sizeComplexScript: extra?.size ?? true,
    color: extra?.color,
    language: { value: "fa-IR", bidirectional: "fa-IR" },
  });
}

const RTL_RUN = {
  font: FA_FONT,
  rightToLeft: true,
  language: { value: "fa-IR" as const, bidirectional: "fa-IR" as const },
  sizeComplexScript: true as const,
};

const RTL_PARAGRAPH = {
  alignment: AlignmentType.RIGHT,
  spacing: { after: 200, line: 276 },
};

function wordSectionProperties() {
  return {
    page: {
      size: { width: 11906, height: 16838 },
      margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
    },
  };
}

const EN_FONT = {
  ascii: "Calibri",
  hAnsi: "Calibri",
  cs: "Calibri",
  eastAsia: "Calibri",
};

const LTR_RUN = {
  font: EN_FONT,
  rightToLeft: false,
  language: { value: "en-US" as const },
};

const LTR_PARAGRAPH = {
  alignment: AlignmentType.LEFT,
  spacing: { after: 200, line: 276 },
};

function ltrParaExtras() {
  return {
    bidirectional: false as const,
    alignment: AlignmentType.LEFT,
    run: { ...LTR_RUN },
  };
}

function rtlParaExtras() {
  return {
    bidirectional: true as const,
    alignment: AlignmentType.RIGHT,
    run: { ...RTL_RUN },
  };
}

function wordStyles() {
  const runFa = { ...RTL_RUN };
  return {
    default: {
      document: {
        run: {
          ...runFa,
          size: 24,
        },
        paragraph: { ...RTL_PARAGRAPH },
      },
      heading1: {
        run: { ...runFa, size: 40, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 200 } },
      },
      heading2: {
        run: { ...runFa, size: 32, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 280, after: 140 } },
      },
      heading3: {
        run: { ...runFa, size: 26, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 180, after: 100 } },
      },
    },
    paragraphStyles: [
      {
        id: "Normal",
        name: "Normal",
        quickStyle: true,
        run: { ...runFa, size: 24 },
        paragraph: { ...RTL_PARAGRAPH },
      },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runFa, size: 40, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 200 } },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runFa, size: 32, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 280, after: 140 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runFa, size: 26, bold: true, boldComplexScript: true, color: NAVY },
        paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 180, after: 100 } },
      },
    ],
  };
}

function wordStylesLtr() {
  const runEn = { ...LTR_RUN };
  return {
    default: {
      document: {
        run: {
          ...runEn,
          size: 22,
        },
        paragraph: { ...LTR_PARAGRAPH },
      },
      heading1: {
        run: { ...runEn, size: 40, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 240, after: 200 },
        },
      },
      heading2: {
        run: { ...runEn, size: 32, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 280, after: 140 },
        },
      },
      heading3: {
        run: { ...runEn, size: 26, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 180, after: 100 },
        },
      },
    },
    paragraphStyles: [
      {
        id: "Normal",
        name: "Normal",
        quickStyle: true,
        run: { ...runEn, size: 22 },
        paragraph: { ...LTR_PARAGRAPH },
      },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runEn, size: 40, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 240, after: 200 },
        },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runEn, size: 32, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 280, after: 140 },
        },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickStyle: true,
        run: { ...runEn, size: 26, bold: true, color: NAVY },
        paragraph: {
          alignment: AlignmentType.LEFT,
          spacing: { before: 180, after: 100 },
        },
      },
    ],
  };
}

function userAskText(text: string) {
  const raw = String(text || "");
  const idx = raw.search(
    /\n(?:نام فایل:|محتوای فایل:|فایل خوانده شد|متن تصویر خوانده شد|متن استخراج‌شده از تصویر:)/
  );
  return (idx >= 0 ? raw.slice(0, idx) : raw).trim();
}

const ORG_BRAND =
  /سی‌پی‌جی\s*پارس|سی پی جی\s*پارس|CPG\s*Pars|سند سازمانی(?:\s*CPGAI)?|گزارش سازمانی(?:\s*CPGAI)?|CPGAI سازمانی/gi;

export function stripSelfIntro(text: string) {
  let t = String(text || "").replace(/^\uFEFF/, "");
  const lead = [
    /^(?:سلام[.،!]?\s*)?(?:من\s+)?CPGAI هستم،?\s*دستیار هوشمند سی[‌ ]?پی[‌ ]?جی پارس[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?دستیار هوشمند سی[‌ ]?پی[‌ ]?جی پارس[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?(?:من\s+)?CPGAI هستم[.،!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?نگاه راهبردی شما[^.!\n]{0,80}[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?دستیار هوشمند(?:\s+واحد)?[^.!\n]{0,60}[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?در خدمت شما هستم[.،!]?\s*/gim,
    /^(?:اطلاعات دقیقی ارائه دادید)[^.!\n]{0,80}[.!]?\s*/gim,
  ];
  let prev = "";
  while (t !== prev) {
    prev = t;
    for (const re of lead) t = t.replace(re, "");
  }
  return t.replace(/^\s+/, "");
}

export function stripOrgBrand(text: string) {
  // Backward-compatible: public-safe strip. Prefer applyAudienceBrand(text, audience).
  return stripSelfIntro(applyAudienceBrand(text, "public"));
}

export function brandForAsk(text: string, userText = "") {
  const audience = detectDocAudience(userText || text, text);
  return stripSelfIntro(applyAudienceBrand(text, audience));
}

function scriptCounts(text: string) {
  const s = String(text || "");
  return {
    fa: (s.match(/[\u0600-\u06FF]/g) || []).length,
    en: (s.match(/[A-Za-z]/g) || []).length,
  };
}

export function isEnglishDocument(text: string, userText = "") {
  if (looksLikeBilingualBody(text)) return false;
  const ask = userAskText(userText);
  const body = String(text || "");
  const a = scriptCounts(ask);
  const b = scriptCounts(body);
  const englishCue =
    /\b(cv|resume|curriculum vitae|\buk\b|london|united kingdom|english)\b/i.test(
      ask
    ) || /انگلیسی/.test(ask);
  const persianDocCue = /شناسنامه|جزوه|خلاصه مدیریتی|گزارش عملکرد|قرارداد/.test(
    ask
  );
  if (b.en > 80 && b.en > b.fa * 2) return true;
  if (englishCue && !persianDocCue && a.fa < 12 && (b.en >= b.fa || b.en > 20)) {
    return true;
  }
  if (a.en > 24 && a.en > a.fa * 2 && b.en >= b.fa && b.en > 20) return true;
  return false;
}

export function isJobProfileRequest(text: string) {
  const t = userAskText(text);
  const lower = t.toLowerCase();
  return (
    t.includes("شناسنامه شغلی") ||
    t.includes("شناسنامه شغل") ||
    t.includes("شرح شغل") ||
    t.includes("شرح وظایف شغل") ||
    lower.includes("job profile") ||
    lower.includes("job description")
  );
}

export type DocIntentType = WorkType;

export function isLessonAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  return /جزوه|سرفصل\s*تدریس|فراگیر|مدرس|دوره\s*آموزش|کلاس\s*آموزش|جزوه\s*آموزش|آموزشی|handbook|courseware/i.test(
    t
  );
}

export function isProjectCharterAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  return /شناسنامه\s*پروژه|منشور\s*پروژه|project\s*charter|شناسنامه\s*طرح/i.test(t);
}

export function isExecSummaryAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (/گزارش\s*عملکرد|kpi|عملکرد\s*سالانه/i.test(t)) return false;
  return /خلاصه\s*مدیریتی|executive\s*summary|چکیده\s*مدیریتی/i.test(t);
}

export function isPerformanceAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  return /گزارش\s*عملکرد|عملکرد\s*سالانه/i.test(t);
}

export function isPptxAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (/متن\s*ارائه|نکته\s*سخنرانی|اسلایدبندی/.test(t)) return false;
  return /پاورپوینت|pptx|powerpoint|اسلاید|ارائه.{0,48}(بده|بساز|کن|آماده|عکس|تصویر|بصری|اینفوگرافیک)|(عکس|تصویر|بصری|اینفوگرافیک).{0,24}(ارائه|پاورپوینت|اسلاید)/i.test(
    t
  );
}

export function wantsVisualPptx(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (!isPptxAsk(t) && !/پاورپوینت|pptx|اسلاید|ارائه/.test(t)) return false;
  return /عکس|تصویر|بصری|اینفوگرافیک|infographic/i.test(t);
}

const QUALITY_WORDS =
  /قوی|خوشگل|زیبا|شیک|حرفه‌ای|حرفه ای|عالی|کامل|دقیق|مدون|جذاب|خوب|بهتر|بهترین/g;

export function extractAttachedDump(text: string) {
  const raw = String(text || "");
  const parts = raw.split(
    /محتوای فایل:|متن از صفحات اسکن‌شده:|متن استخراج‌شده از تصویر:|متن فایل Word قبلی:|محتوای اصلی برای تبدیل به پاورپوینت/
  );
  if (parts.length < 2) return "";
  return parts.slice(1).join("\n").trim();
}

function stripQualityWords(value: string) {
  return String(value || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(QUALITY_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicFromAttachedSource(fullText: string) {
  const dump = extractAttachedDump(fullText);
  const hay = dump || fullText || "";
  if (/\bCSCU\b/i.test(hay)) return "CSCU";
  const heading = firstHeading(dump);
  if (heading && heading.length >= 2 && heading.length <= 60) {
    const clean = stripQualityWords(heading);
    if (clean && !QUALITY_WORDS.test(clean)) return clean.slice(0, 48);
  }
  const acr = hay.match(/\b[A-Z]{3,8}\b/);
  if (acr && !/PDF|DOCX|PPTX|HTTP|JPEG|PNG/.test(acr[0])) return acr[0];
  return "";
}

function extractDocTopic(ask: string) {
  let t = userAskText(ask)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  t = t.replace(/دستور\s*اصلاح(?:\s*کاربر)?/g, " ");
  t = t.replace(QUALITY_WORDS, " ");
  t = t.replace(
    /جزوه(?:\s*آموزشی)?|آموزشی|آموزش|کلاس|دوره|مدرس|فراگیر|سرفصل(?:\s*تدریس)?|تدریس|شناسنامه(?:\s*شغلی|\s*شغل|\s*پروژه|\s*طرح)?|شرح\s*شغل|شرح\s*وظایف(?:\s*شغل)?|job\s*profile|job\s*description|منشور\s*پروژه|ترجمه(?:\s*کن(?:ید)?)?|دو\s*زبانه|دوزبانه|bilingual|خلاصه(?:\s*مدیریتی)?|executive\s*summary|گزارش(?:\s*عملکرد)?|سالانه|\bkpi\b|ارائه|پاورپوینت|اسلاید|pptx|powerpoint|فایل|docx|\bword\b|ورد|pdf|xlsx|اکسل|بده|بساز|آماده\s*کن|تهیه\s*کن|خروجی|دانلود|لینک|برای\s*مبتدی|مبتدی|انگلیسی|فارسی/gi,
    " "
  );
  t = t.replace(
    /(^|\s)(کن|را|رو|این|همین|یک|یه|از|با|باید|باشد|نه|فقط)(?=\s|$)/g,
    " "
  );
  t = t.replace(/[«»"'():،,]/g, " ").replace(/\s+/g, " ").trim();
  t = stripQualityWords(t);
  if (!t || QUALITY_WORDS.test(t)) return "";
  return t.slice(0, 48);
}

export function detectDocumentIntent(text: string, body = "") {
  return resolveIntent(text, body);
}

function jobProfileFileKind(text: string): FileKind {
  return detectExplicitOutputKind(userAskText(text)) || "word";
}

export function looksLikeStockPerformanceDeck(text: string) {
  const t = String(text || "");
  const hits = [
    /۲۱۳۵|2135/,
    /تحقق برنامه تولید/,
    /توقف اضطراری/,
    /رضایت مشتری/,
    /گزارش عملکرد سالانه سی‌پی‌جی/,
    /درآمد عملیاتی/,
  ].filter((re) => re.test(t)).length;
  return hits >= 2;
}

export function looksLikeManagementPerformanceReport(text: string) {
  const t = text || "";
  const hits = [
    "گزارش عملکرد سالانه",
    "درآمد عملیاتی",
    "روند درآمد",
    "تحقق برنامه تولید",
    "خلاصه مدیریتی",
  ].filter((key) => t.includes(key)).length;
  return hits >= 2;
}

function looksLikeIncompleteJobProfile(text: string) {
  const t = text || "";
  if (looksLikeManagementPerformanceReport(t)) return true;
  const sections = [
    /شناسنامه شغلی|شرح شغل/,
    /عنوان شغل/,
    /هدف شغل/,
    /وظایف/,
    /شرایط احراز/,
  ];
  const hits = sections.filter((re) => re.test(t)).length;
  if (hits < 4) return true;
  if (countWords(t) < 350) return true;
  if (!/[-*•]/.test(t) && !t.includes("|")) return true;
  return false;
}

type FormatHit = { kind: FileKind; index: number; score: number };

export function isHelpOrSystemAsk(text: string) {
  const t = userAskText(text);
  const lower = t.toLowerCase();
  if (
    /مشکل از کجا|علت چیست|علتش چیه|علتش چی|کمک کن|راهنمایی|درستش کنم|چطور (?:درست|عوض|برگردون)|چرا (?:شده|عوض|می)|فرداش شده|عوض شده/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /ویندوز|\bwindows\b|\bgpo\b|گروپ\s*پالیسی|group policy|دامین|\bdomain\b|رجیستری|\bregistry\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /پیش‌فرض|پیشفرض|دیفالت|default\s*apps?|اپ پیش‌فرض|برنامه پیش‌فرض|مرورگر پیش‌فرض|open with|باز کردن با/.test(
      t + " " + lower
    )
  ) {
    return true;
  }
  if (/تنظیمات/.test(t) && /(?:برنامه|اپ|pdf|مرورگر|ویندوز)/i.test(t + " " + lower)) {
    return true;
  }
  return false;
}

export function isDocReviseAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (!t || isHelpOrSystemAsk(t)) return false;
  const revise =
    /اصلاح\s*کن|اصلاح[‌\s]*شده|درست\s*کن|مجدداً?\s*بفرست|دوباره\s*بفرست|دوباره\s*بساز|فایل\s*اصلاح|دانلود\s*کنم|لینک\s*دانلود|دانلود\s*بده|جدول را در فایل|داخل فایل بگذار|تو فایل بگذار|همین\s*(?:word|ورد).{0,24}درست|فایل را دوباره|ورد را دوباره|word را دوباره/i.test(
      t
    );
  const fileish = /فایل|ورد|\bword\b|docx|جدول|دانلود|گزارش|سند/i.test(t);
  return revise && fileish;
}

export function isBilingualAsk(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (!t || isHelpOrSystemAsk(t)) return false;
  return /ترجمه\s*کن|ترجمه\s*کنید|دو\s*زبانه|دوزبانه|\bbilingual\b|انگلیسی با ترجمه|با ترجمه فارسی|english with persian|\btranslate\b/i.test(
    t
  );
}

export { hasContractSignal } from "@/lib/pdf-extract";

export function bilingualDocumentPrompt() {
  return [
    "تو مترجم حقوقی قرارداد هستی، نه گزارش‌نویس عملکرد.",
    "خلاصه مدیریتی، KPI، جدول شاخص خالی، تحلیل روند، ریسک سازمانی و اقدامات پیشنهادی مطلقاً ممنوع است.",
    "خروجی فقط ترجمه دوزبانه همان قرارداد خوانده‌شده است.",
    "برای هر بند یا پاراگراف دقیقاً این قالب را تکرار کن:",
    "EN: متن انگلیسی اصلی عیناً",
    "FA: ترجمه فارسی همان بند بلافاصله زیر آن",
    "هیچ بند خوانده‌شده را حذف نکن و خلاصه نکن.",
    "عدد، تاریخ، نام شرکت و شماره ماده را عوض نکن.",
    "اگر کلمه‌ای ناخوانا بود بنویس [در تصویر ناخوانا] و حدس نزن.",
    "جمله گفتگویی ننویس. قالب گزارش عملکرد سالانه ممنوع است.",
    "عنوان/جلد، طرفین، موضوع و مواد را اگر در منبع هست حتماً بیاور.",
  ].join(" ");
}

export function splitContractChunks(text: string, size = 3200) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parts = raw.split(
    /(?=\n(?:ARTICLE|Article|Clause|CLAUSE|WHEREAS|ماده)\b)/
  );
  const chunks: string[] = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + part).length > size && buf.trim()) {
      chunks.push(buf.trim());
      buf = part;
    } else {
      buf += part;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.slice(0, 8);
}

export function looksLikeBilingualBody(text: string) {
  const en = (String(text || "").match(/^EN:\s*/gim) || []).length;
  const fa = (String(text || "").match(/^FA:\s*/gim) || []).length;
  return en >= 3 && fa >= 3;
}

export function isForcedWordAsk(text: string) {
  const raw = String(text || "");
  const t = userAskText(raw)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  if (!t || isHelpOrSystemAsk(t)) return false;
  const hasFile =
    /محتوای فایل:|فایل خوانده شد|نام فایل:|متن فایل Word قبلی|دستور اصلاح کاربر:/.test(
      raw
    );
  const wordCue =
    /docx|\bword\b|فایل\s*word|فایل\s*ورد|لینک\s*دانلود|(^|[^\u0600-\u06FF])ورد(?=[^\u0600-\u06FF]|$)/i.test(
      t
    );
  const rebuild =
    /دوباره\s*بساز|اصلاح\s*کن|اصلاح[‌\s]*شده|مجدداً?\s*بفرست|خروجی|دانلود\s*بده|دانلود\s*کنم/.test(
      t
    );
  if (isBilingualAsk(t)) return true;
  if (wordCue) return true;
  if (hasFile && rebuild) return true;
  return false;
}

export function isFileBuildIntent(text: string) {
  const t = userAskText(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  const lower = t.toLowerCase();
  const hay = t + "\n" + lower;
  if (isHelpOrSystemAsk(t)) return false;
  if (isDocReviseAsk(t)) return true;
  if (
    /همین\s*(?:را|رو).{0,24}(?:pdf|پی‌دی‌اف|پی\s*دی\s*اف|ورد|word|پاورپوینت|pptx)/i.test(
      t
    ) ||
    /(?:pdf|پی‌دی‌اف|ورد|word|پاورپوینت)\s*کن/i.test(t)
  ) {
    return true;
  }
  if (
    (isLessonAsk(t) ||
      isJobProfileRequest(t) ||
      isProjectCharterAsk(t) ||
      isExecSummaryAsk(t) ||
      isPerformanceAsk(t) ||
      isBilingualAsk(t) ||
      /\bresume\b|\bcv\b|رزومه|بازار کار/i.test(t)) &&
    /بده|بساز|خروجی|دانلود|تهیه|آماده/.test(t)
  ) {
    return true;
  }
  const format =
    /pdf|پی‌دی‌اف|پی\s*دی\s*اف|docx|\bword\b|ورد|xlsx|\bexcel\b|اکسل|pptx|powerpoint|پاورپوینت|پاور\s*پوینت|اسلاید/i.test(
      hay
    );
  const verb =
    /بساز|آماده\s*کن|تهیه\s*کن|خروجی|دانلود|به صورت|به‌صورت|بصورت|در قالب|فایل\s*(بده|بساز|کن)|پاورپوینت\s*کن|ورد\s*کن|اصلاح\s*کن|مجدداً?\s*بفرست|دوباره\s*بفرست/.test(
      t
    ) || /(?:make|download|export)\s+(?:a\s+)?(?:pdf|word|excel|ppt)/i.test(lower);
  return format && verb;
}

function detectExplicitOutputKind(ask: string): FileKind | null {
  const t = String(ask || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
  const lower = t.toLowerCase();
  const hits: FormatHit[] = [];

  function pushMatches(kind: FileKind, re: RegExp, hay: string) {
    const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = copy.exec(hay))) {
      const index = match.index;
      const before = hay.slice(Math.max(0, index - 32), index);
      const around = hay.slice(Math.max(0, index - 32), index + match[0].length + 20);
      const inputOnly =
        /(?:از روی|از این|روی این|این فایل|فایل پیوست|پیوست|منبع|آپلود)\s*$/.test(
          before
        );
      const output =
        /خروجی|به صورت|به‌صورت|بصورت|در قالب|دانلود|بساز|آماده\s*کن|تهیه\s*کن|فایل\s*(بده|بساز)|پاورپوینت\s*کن|لینک\s*دانلود|دوباره\s*بساز/.test(
          around
        );
      if (inputOnly && !output) continue;
      if (!output && !/دانلود|بساز|خروجی|لینک/.test(hay)) continue;
      hits.push({
        kind,
        index,
        score: 3,
      });
    }
  }

  pushMatches("pptx", /pptx|powerpoint|پاورپوینت|پاور\s*پوینت/i, lower);
  pushMatches("pptx", /پاورپوینت|پاور\s*پوینت/g, t);
  pushMatches("xlsx", /xlsx|\bexcel\b|اکسل/i, lower);
  pushMatches("xlsx", /اکسل/g, t);
  pushMatches(
    "word",
    /docx|\bword\b|فایل\s*ورد|خروجی\s*ورد|سند\s*ورد/i,
    lower
  );
  pushMatches("word", /(^|[^\u0600-\u06FF])ورد(?=[^\u0600-\u06FF]|$)/g, t);
  pushMatches("pdf", /\bpdf\b|پی‌دی‌اف|پی\s*دی\s*اف/i, lower);
  pushMatches("pdf", /پی‌دی‌اف|پی\s*دی\s*اف/g, t);

  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score || b.index - a.index);
  return hits[0].kind;
}

function wantsGeneratedDocument(ask: string) {
  const t = String(ask || "");
  if (isHelpOrSystemAsk(t)) return false;
  if (!isFileBuildIntent(t)) return false;
  return /خروجی|به صورت|بصورت|در قالب|فایل\s*(بده|بساز|کن)|تهیه کن|گزارش.{0,40}(تهیه|بساز|بده|فایل)|سند\s*(بده|بساز)/.test(
    t
  );
}

export function detectFileKind(text: string): FileKind | null {
  if (!wantsFileOutput(text)) return null;
  if (isHelpOrSystemAsk(text)) return null;
  const intent = detectDocumentIntent(text);
  const fromIntent = intentOutputKind(intent);
  if (fromIntent) return fromIntent;
  if (intent.type === "job_profile" || isJobProfileRequest(text)) {
    return jobProfileFileKind(text);
  }

  const ask = userAskText(text);
  if (isForcedWordAsk(text) || isDocReviseAsk(ask)) return "word";
  if (!isFileBuildIntent(ask) && (intent.type === "chat" || intent.format === "chat")) {
    return null;
  }

  const explicit = detectExplicitOutputKind(ask);
  if (explicit) return explicit;

  if (/اسلاید/.test(ask) && !/اسلایدبندی|متن ارائه|نکته سخنرانی/.test(ask)) {
    return "pptx";
  }
  if (/خروجی\s*جدول|فایل\s*جدول|جدول\s*اکسل/.test(ask)) return "xlsx";

  const hasSource =
    /محتوای فایل:|فایل خوانده شد|متن تصویر|نام فایل:/.test(text || "");
  if (hasSource && wantsGeneratedDocument(ask)) return "word";

  return null;
}

export {
  isPresentationScriptRequest,
  presentationScriptPrompt,
} from "./presentation-script";

function jobProfileSystemPrompt(userText: string) {
  const fromFile = /محتوای فایل:|فایل خوانده شد|متن تصویر|متن استخراج‌شده از تصویر/.test(userText);
  return [
    "تو کارشناس منابع انسانی هستی و فقط شناسنامه شغلی / شرح شغل می‌نویسی.",
    "گزارش‌نویس مدیریتی نیستی.",
    "قالب «گزارش عملکرد سالانه»، KPI شرکتی، روند درآمد، تحلیل ریسک پروژه و خلاصه مدیریتی مطلقاً ممنوع است.",
    "فقط متن نهایی سند را بنویس؛ جمله گفتگویی ننویس.",
    "معرفی ممنوع است. من CPGAI هستم / دستیار هوشمند / در خدمت شما هستم را ننویس.",
    fromFile
      ? [
          "متن فایل یا تصویر منبع است. فقط همان عبارات خوانده‌شده را بنویس.",
          "اگر عنوان، موضوع، طرف قرارداد یا شرح کار در متن هست همان را بیاور.",
          "برای فیلدهای خالی «قابل تشخیص نیست» را در همه خانه‌ها تکرار نکن؛ بخش خوانده‌شده را بنویس و بقیه را خالی بگذار.",
          "عدد و نام ساختگی نساز.",
        ].join(" ")
      : "اگر جزئیات کم بود، یک شناسنامه شغلی کامل و قابل استفاده سازمانی بنویس، نه گزارش عملکرد.",
    "اگر منبع قرارداد نظارت، بهره‌برداری یا مهندسی معکوس بود، عنوان شغل را متناسب با همان قرارداد بساز؛ مثل کارشناس نظارت بهره‌برداری، کارشناس نظارت، یا کارشناس مهندسی معکوس.",
    "اگر هر دو حوزه در یک قرارداد آمده، یک شناسنامه برای نقش مرتبط با همان قرارداد بنویس و وظایف اجرایی هر دو حوزه مرتبط را از متن دربیاور.",
    "خط اول عنوان سند حتماً این باشد: شناسنامه شغلی",
    "سپس دقیقاً این بخش‌ها را با ## بیاور:",
    "## اطلاعات شغل",
    "حتماً جدول فیلد | مقدار شامل: عنوان شغل، واحد سازمانی، محل خدمت، رتبه/رده، مدیر مستقیم.",
    "TABLE:",
    "فیلد | مقدار",
    "## هدف شغل",
    "## وظایف و مسئولیت‌ها",
    "لیست مشخص، اجرایی و قابل ارزیابی. هر وظیفه با - در یک خط. کلی‌گویی ممنوع.",
    "## اختیارات",
    "## شرایط احراز",
    "زیربخش‌ها: تحصیلات، سابقه، دانش تخصصی، مهارت‌ها.",
    "## ارتباط‌های سازمانی",
    "زیربخش‌ها: درون‌واحدی، برون‌واحدی.",
    "## شاخص‌های عملکرد شغل",
    "فقط شاخص‌های خودِ شغل و دارنده شغل؛ مثل کیفیت گزارش نظارت، رعایت برنامه بازدید، دقت مستندسازی، زمان پاسخ به انحراف. شاخص درآمد شرکت، تولید کارخانه، روند فروش و KPI شرکتی ممنوع است.",
    "## شرایط محیطی و الزامات خاص",
    "فقط اگر در منبع آمده باشد.",
    "فهرست‌ها را با - بنویس. لحن رسمی منابع انسانی و فارسی کامل باشد.",
    "خروجی باید کامل و قابل استفاده در سازمان باشد، نه خلاصه ضعیف.",
  ].join(" ");
}

function fromSourceSystemPrompt(common: string[]) {
  return [
    ...common,
    "اولویت با متن منبع پیوست است. از همان بنویس.",
    "قالب SAMPLE گزارش عملکرد سالانه، درآمد ساختگی و تحقق ۹۸٪ ممنوع است مگر خود منبع همان باشد.",
    "دستور کاربر و «فایل خوانده شد» را داخل سند نگذار.",
    "یک سند کامل درباره همان موضوع/منبع بنویس.",
  ].join(" ");
}

export function documentSystemPrompt(kind: FileKind, userText = "") {
  const intent = detectDocumentIntent(userText);
  if (intent.type === "translation") {
    return bilingualDocumentPrompt();
  }
  if (intent.type === "job_profile" || isJobProfileRequest(userText)) {
    return jobProfileSystemPrompt(userText);
  }

  const fromFile = /محتوای فایل:|فایل خوانده شد|متن تصویر|متن استخراج‌شده از تصویر|پروپوزال|طرح پیشنهادی|متن فایل Word قبلی|دستور اصلاح کاربر:/.test(
    userText
  );
  const audience = intent.audience || detectDocAudience(userText);
  const topicLine = intent.topic
    ? "موضوع سند دقیقاً «" + intent.topic + "» است."
    : "موضوع را از درخواست کاربر بگیر و دقیق همان را پوشش بده.";
  const sourceLine = fromFile
    ? "متن فایل یا تصویر منبع است. از همان استفاده کن و نمونه ساختگی نساز."
    : "اگر جزئیات کم بود، همان موضوع را کامل و قابل استفاده بنویس؛ تیتر alone ممنوع.";
  const common = [
    "فقط متن نهایی سند را بنویس؛ جمله گفتگویی ننویس.",
    "معرفی ممنوع است. من CPGAI هستم / دستیار هوشمند / در خدمت شما هستم را داخل سند ننویس.",
    topicLine,
    sourceLine,
    "محتوا باید کامل و قابل استفاده باشد. عنوان خالی بدون شرح ممنوع است.",
    "نگو نمی‌توانی فایل بدهی.",
    "اولویت با متن منبع است. SAMPLE عملکرد سالانه و عدد ساختگی ممنوع است مگر منبع همان باشد.",
    

    ...audiencePromptLines(audience),
  ];

  if (intent.type === "resume") {
    return [
      ...common,
      "یک رزومه / CV کامل و قابل استفاده برای بازار کار بنویس.",
      "گزارش عملکرد سالانه سازمانی، درآمد شرکت و تحقق ۹۸٪ ممنوع است.",
      "اگر خروجی انگلیسی است (CV، resume، UK، London یا منبع انگلیسی): کل متن انگلیسی باشد.",
      "نام شخص: First Last مثل John Smith. هرگز LAST FIRST یا برعکس‌نویسی نکن.",
      "عنوان بخش‌ها: Professional Summary, Work Experience, Education, Skills. هرگز SUMMARY PROFESSIONAL ننویس.",
      "اگر خروجی فارسی است ساختار فارسی بماند: مشخصات، خلاصه حرفه‌ای، سوابق، تحصیلات، مهارت‌ها.",
      "اگر منبع شخص خاصی است همان نام و سوابق را بیاور.",
    ].join(" ");
  }
  if (intent.type === "training") {
    return [
      ...common,
      "تو مدرس حرفه‌ای هستی و یک جزوه آموزشی کامل و قابل تدریس می‌نویسی.",
      "گزارش عملکرد سالانه، KPI شرکتی، خلاصه مدیریتی سازمانی و جدول درآمد ممنوع است.",
      "ساختار پیشنهادی: عنوان دوره، مخاطب، پیش‌نیاز، اهداف یادگیری، سرفصل‌ها، شرح هر سرفصل با مثال، تمرین/پرسش، جمع‌بندی.",
      "لحن آموزشی روشن باشد. حداقل چند بخش کامل بنویس نه فقط فهرست تیتر.",
    ].join(" ");
  }
  if (intent.type === "project_charter") {
    return [
      ...common,
      "تو کارشناس کنترل پروژه هستی و شناسنامه / منشور پروژه می‌نویسی.",
      "گزارش عملکرد سالانه و KPI فروش ممنوع است.",
      "ساختار: عنوان پروژه، هدف، محدوده، ذی‌نفعان، خروجی‌ها، زمان‌بندی کلان، ریسک‌ها، پیش‌فرض‌ها، معیار موفقیت.",
      fromFile ? "نام‌ها و اعداد را فقط از منبع بردار." : "اگر عدد نبود، حدس سازمانی نزن؛ بخش را کیفی کامل بنویس.",
    ].join(" ");
  }
  if (intent.type === "brief") {
    return [
      ...common,
      "فقط خلاصه مدیریتی همان فایل یا موضوع منبع را بنویس.",
      "گزارش عملکرد سالانه نمونه و جدول KPI ساختگی ممنوع است مگر همان اعداد در منبع باشد.",
      "ساختار: عنوان، پیام اصلی، یافته‌های کلیدی، تصمیم/اقدام پیشنهادی. کوتاه ولی کامل.",
    ].join(" ");
  }
  if (intent.type === "from_source") {
    return fromSourceSystemPrompt(common);
  }

  const perfCommon = fromFile
    ? [
        ...common,
        "اگر عددی در فایل نبود، عدد ساختگی اضافه نکن.",
      ]
    : [
        ...common,
        "اگر کاربر عدد نداد، اعداد نمونه منطقی بساز و کنارشان بنویس (نمونه).",
        "واحد را مشخص کن: درصد، میلیارد تومان، نفر، تن، ساعت.",
      ];

  if (kind === "pptx" || intent.type === "presentation") {
    const stockBan =
      "اعداد و داستان گزارش عملکرد سالانه سی‌پی‌جی ممنوع است مگر در خود منبع باشد: درآمد ۲۱۳۵، تحقق ۹۸٪، توقف اضطراری، رضایت مشتری، تولید کنسانتره.";
    if (intent.type === "performance") {
      return [
        ...perfCommon,
        "خروجی ارائه گزارش عملکرد است چون کاربر صریحاً عملکرد سالانه خواسته.",
        "هر اسلاید با SLIDE: شروع شود.",
        "SLIDE: عنوان ارائه",
        "SLIDE: خلاصه مدیریتی",
        "SLIDE: شاخص‌های کلیدی",
        "SLIDE: تحلیل",
        "SLIDE: اقدامات",
      ].join(" ");
    }
    return [
      ...common,
      "خروجی پاورپوینت است. هر اسلاید را با SLIDE: شروع کن.",
      "محتوا را فقط از موضوع/منبع درخواست بردار. نمونه عملکرد سالانه ممنوع است.",
      stockBan,
      "اسلاید اول باید عنوان همان موضوع باشد، نه دستور کاربر و نه «فایل خوانده شد».",
      "اگر منبع جزوه/آموزش است: معرفی، اهداف، مخاطب، سرفصل‌ها، مفاهیم کلیدی، مثال/تمرین، جمع‌بندی.",
      "اگر منبع فایل پیوست است: عنوان، ضرورت، وضع موجود، راه‌حل یا سرفصل‌های همان سند، اعداد فقط از فایل.",
      "برند شرکت را فقط اگر در منبع آمده بنویس.",
      "پاراگراف بلند ممنوع. هر اسلاید حداکثر ۵ بولت کوتاه.",
    ].join(" ");
  }

  if (kind === "xlsx") {
    return [
      ...common,
      "حتماً دو شیت:",
      "SHEET: داده خام",
      "HEADERS: ماه | تولید_تن | درآمد_میلیارد_تومان | توقف_ساعت | نیروی_انسانی_نفر | رضایت_درصد",
      "۱۲ ردیف ماهانه با عدد خام قابل جمع، بدون millه جداکننده هزارگان اگر ممکن است.",
      "SHEET: KPI",
      "HEADERS: شاخص | واحد | سال_قبل | سال_جاری | تغییر | وضعیت",
      "حداقل ۶ شاخص با عدد.",
    ].join(" ");
  }

  if (intent.type === "performance") {
    return [
      ...perfCommon,
      "این سند گزارش عملکرد است چون کاربر صریحاً گزارش عملکرد/KPI سالانه خواسته.",
      "ساختار الزامی:",
      "عنوان، ## خلاصه مدیریتی، ## شاخص‌های کلیدی عملکرد، جدول شاخص‌ها، ## تحلیل روند، ## ریسک‌ها و چالش‌ها، ## اقدامات پیشنهادی با اولویت کوتاه‌مدت و میان‌مدت، ## جمع‌بندی.",
      "جدول را دقیقاً با این قالب بنویس:",
      "TABLE:",
      "شاخص | واحد | سال قبل | سال جاری | تغییر",
      fromFile
        ? "اعداد را فقط از منبع بگذار. درآمد ۲۱۳۵ و تحقق ۹۸٪ را نساز مگر در منبع باشد."
        : "درآمد عملیاتی | میلیارد تومان | 1840 | 2135 | +16٪ (نمونه)",
      "حداقل یک جدول ۵ ستونی و ۶ ردیفی.",
      "حداقل ۸۰۰ کلمه و چند عدد مشخص.",
    ].join(" ");
  }

  return fromSourceSystemPrompt(common);
}

export function looksLikeChatNotDocument(
  text: string,
  kind: FileKind,
  userText = ""
) {
  const intent = detectDocumentIntent(userText);
  if (intent.type === "translation") {
    return !looksLikeBilingualBody(text) && looksLikeManagementPerformanceReport(text);
  }
  if (intent.type === "job_profile" || isJobProfileRequest(userText)) {
    return looksLikeIncompleteJobProfile(text);
  }

  const t = (text || "").replace(/\s+/g, " ").trim();
  const bad = [
    "نمی‌توانم",
    "نمي‌توانم",
    "متن را بفرست",
    "موضوع را بفرست",
    "لطفا موضوع",
    "لطفاً موضوع",
    "چه موضوعی",
    "جزئیات بیشتری",
    "اطلاعات بیشتری",
    "نمی‌توانم فایل",
    "امکان ایجاد پیوست",
    "لینک قابل دانلود نخواهد بود",
    "فایل باینری در دسترس نیست",
    "پیوست در دسترس نیست",
  ];
  if (bad.some((key) => t.includes(key))) return true;
  if (kind === "xlsx") return !t.includes("|") || !/[0-9۰-۹]/.test(t);
  if (kind === "pptx" || intent.type === "presentation") {
    return !/SLIDE:/i.test(text) || countWords(t) < 80;
  }
  if (
    intent.type === "training" ||
    intent.type === "project_charter" ||
    intent.type === "brief" ||
    intent.type === "from_source" ||
    intent.type === "resume"
  ) {
    if (looksLikeManagementPerformanceReport(text)) {
      return true;
    }
    return countWords(t) < 220;
  }
  if (intent.type === "performance") {
    return (
      countWords(t) < 280 ||
      !t.includes("|") ||
      !/[0-9۰-۹]/.test(t)
    );
  }
  return countWords(t) < 200;
}

export function extractDocumentBody(text: string) {
  let body = (text || "").trim();
  body = body.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  body = stripSelfIntro(body);
  const skip =
    /^(حتماً|حتما|چشم|باشه|البته|در ادامه|در زیر|سند زیر|گزارش زیر|فایل آماده|متن سند|من CPGAI هستم|دستیار هوشمند|در خدمت شما هستم)/;
  const lines = body.split("\n");
  while (lines.length && (!lines[0].trim() || skip.test(lines[0].trim()))) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

export const SAMPLE: Record<FileKind, string> = {
  word: `گزارش عملکرد سالانه سی‌پی‌جی پارس (نمونه)

## خلاصه مدیریتی
در سال مورد بررسی، سی‌پی‌جی پارس درآمد عملیاتی را از ۱٬۸۴۰ به ۲٬۱۳۵ میلیارد تومان رساند؛ رشد ۱۶ درصد (نمونه). تولید کنسانتره به ۱٫۲۶ میلیون تن رسید که ۴ درصد بالاتر از سال قبل است. تحقق برنامه تولید ۹۸ درصد و تحویل به‌موقع ۹۴ درصد بوده است. نقطه قوت، پایداری کیفیت در ۹۹٫۲ درصد محصول مطابق مشخصات است. نقطه ضعف، توقف اضطراری ۴۸۰ ساعت و تأخیر تأمین اقلام طولانی‌خرید است که حدود ۲۲۰ میلیارد تومان فرصت فروش را جابه‌جا کرده است. پیشنهاد فوری: قفل تأمین دو هفته زودتر، گزارش روزانه یک‌صفحه‌ای، و بستن سه شبه‌حادثه باز تا پایان ماه بعد.

## شاخص‌های کلیدی عملکرد
اعداد زیر نمونه مدیریتی است و در صورت دریافت داده واقعی باید جایگزین شود.

TABLE:
شاخص | واحد | سال قبل | سال جاری | تغییر
درآمد عملیاتی | میلیارد تومان | 1840 | 2135 | +16٪
سود ناخالص | میلیارد تومان | 312 | 368 | +18٪
تولید کنسانتره | هزار تن | 1210 | 1260 | +4٪
تحقق برنامه تولید | درصد | 96 | 98 | +2 واحد
تحویل به‌موقع | درصد | 91 | 94 | +3 واحد
توقف اضطراری | ساعت | 610 | 480 | -21٪
رضایت مشتری | درصد | 86 | 89 | +3 واحد
نرخ حوادث قابل ثبت | مورد در میلیون نفر-ساعت | 1.8 | 1.1 | بهبود
نیروی انسانی مستقیم | نفر | 1420 | 1465 | +45 نفر
پیشرفت پروژه‌های سرمایه‌ای | درصد | 62 | 74 | +12 واحد

## تحلیل روند
رشد درآمد بیشتر از رشد تناژ بوده است؛ یعنی ترکیب محصول و نرخ فروش کمک کرده، نه فقط حجم. در نیمه اول سال، توقف‌های مکانیکی خط خردایش ۳۱ درصد کل توقف اضطراری را ساخته است. از شهریور با برنامه نت پیشگیرانه، میانگین توقف ماهانه از ۵۲ ساعت به ۳۱ ساعت رسیده است. تحویل به‌موقع در فصل چهارم به ۹۶ درصد رسید، اما در خرداد به‌دلیل کمبود دو قطعه وارداتی تا ۸۸ درصد افت کرد. این نوسان نشان می‌دهد ریسک تأمین، بیشتر از ریسک ظرفیت است.

کیفیت پایدار مانده و برگشت کالا از ۱٫۴ درصد به ۰٫۹ درصد کاهش یافته است. بخش باقی‌مانده عمدتاً نقص مدارک خروج است نه عیب فرآوری. رضایت مشتری ۳ واحد بهتر شده، اما شکایت تأخیر هنوز ۴۱ درصد کل شکایت‌ها را می‌سازد.

## ریسک‌ها و چالش‌ها
- تأمین قطعات با زمان خرید بالای ۴۵ روز هنوز موجودی حداقل ندارد.
- ثبت علت توقف در ۲۲ درصد شیفت‌ها ناقص است و ریشه مشکل را پنهان می‌کند.
- سه شبه‌حادثه جابه‌جایی مواد باز است و اگر بسته نشود احتمال تبدیل به حادثه وجود دارد.
- وابستگی ۱۴ درصد درآمد به یک مشتری عمده، ریسک تمرکز فروش ایجاد کرده است.

## اقدامات پیشنهادی
کوتاه‌مدت (۳۰ تا ۶۰ روز):
- تعریف موجودی حداقل برای ۱۲ قلم بحرانی و خرید پوشش ۸ هفته
- استقرار برگ ثبت توقف با کد علت، مسئول شیفت و زمان شروع/پایان
- بستن سه شبه‌حادثه باز با مسئول ایمنی و موعد مشخص

میان‌مدت (۳ تا ۶ ماه):
- نت پیشگیرانه خط خردایش با هدف توقف اضطراری زیر ۳۵۰ ساعت در سال بعد
- تنوع کانال فروش برای کاهش سهم مشتری عمده به کمتر از ۱۰ درصد
- اتصال برنامه تولید هفتگی به موجودی لحظه‌ای انبار

## جمع‌بندی
عملکرد سال جاری از نظر درآمد، کیفیت و ایمنی رو به جلو بوده است. گلوگاه اصلی ظرفیت نیست، پیش‌بینی تأمین و انضباط داده است. اگر سه اقدام کوتاه‌مدت اجرا شود، گزارش فصل بعد باید توقف اضطراری را حداقل ۱۵ درصد و تحویل به‌موقع را به بالای ۹۶ درصد برساند.`,
  pdf: "",
  pptx: `SLIDE: عملکرد سالانه ۱۴۰۳
SUB: روایت مدیریتی نتایج عملیات، کیفیت و تأمین
ORG: سی‌پی‌جی پارس
SLIDE: خلاصه مدیریتی
- درآمد ۲۱۳۵ میلیارد تومان؛ رشد ۱۶٪ (نمونه)
- تحقق برنامه تولید ۹۸٪ و تحویل به‌موقع ۹۴٪
- توقف اضطراری ۲۱٪ کمتر شد؛ ریسک اصلی تأمین قطعه است
SLIDE: شاخص‌های کلیدی
KPI: درآمد | 2135 | میلیارد تومان | +16٪
KPI: تولید | 1.26 | میلیون تن | +4٪
KPI: تحقق برنامه | 98 | درصد | +2 واحد
KPI: تحویل به‌موقع | 94 | درصد | +3 واحد
KPI: توقف اضطراری | 480 | ساعت | -21٪
KPI: رضایت مشتری | 89 | درصد | +3 واحد
SLIDE: روند فصلی
TABLE:
فصل | تولید | درآمد | توقف
بهار | 298 | 485 | 164
تابستان | 325 | 535 | 113
پاییز | 321 | 551 | 88
زمستان | 316 | 564 | 77
SLIDE: تحلیل عملکرد
- قوت: کیفیت ۹۹٫۲٪ و رشد درآمد بیشتر از رشد تناژ
- قوت: توقف ماهانه از ۵۲ به ۳۱ ساعت پس از شهریور
- ضعف: افت تحویل خرداد تا ۸۸٪ به‌خاطر قطعه وارداتی
- ضعف: ۱۴٪ درآمد وابسته به یک مشتری عمده
SLIDE: ریسک‌ها
- ۱۲ قلم بحرانی بدون موجودی حداقل
- ۲۲٪ شیفت‌ها علت توقف را ناقص ثبت می‌کنند
- ۳ شبه‌حادثه جابه‌جایی مواد هنوز باز است
- تمرکز فروش روی یک مشتری عمده
SLIDE: اقدامات پیشنهادی
ACTION: فوری | پوشش ۸ هفته اقلام بحرانی | تدارکات
ACTION: فوری | بستن ۳ شبه‌حادثه باز | ایمنی
ACTION: کوتاه‌مدت | برگ ثبت توقف با کد علت | عملیات
ACTION: کوتاه‌مدت | چک‌لیست خروج کالا | تضمین کیفیت
ACTION: میان‌مدت | توقف اضطراری زیر ۳۵۰ ساعت | نگهداری
ACTION: میان‌مدت | کاهش سهم مشتری عمده به زیر ۱۰٪ | فروش`,
  xlsx: `SHEET: داده خام
HEADERS: ماه | تولید_تن | درآمد_میلیارد_تومان | توقف_ساعت | نیروی_انسانی_نفر | رضایت_درصد
فروردین | 102000 | 162 | 54 | 1432 | 87
اردیبهشت | 98000 | 155 | 49 | 1435 | 88
خرداد | 101000 | 168 | 61 | 1440 | 86
تیر | 108000 | 178 | 42 | 1448 | 88
مرداد | 110000 | 181 | 38 | 1452 | 89
شهریور | 107000 | 176 | 33 | 1455 | 89
مهر | 109000 | 184 | 31 | 1458 | 90
آبان | 111000 | 188 | 29 | 1460 | 90
آذر | 106000 | 179 | 28 | 1462 | 91
دی | 108000 | 183 | 27 | 1463 | 91
بهمن | 105000 | 180 | 26 | 1464 | 90
اسفند | 107000 | 186 | 24 | 1465 | 89
SHEET: KPI
HEADERS: شاخص | واحد | سال_قبل | سال_جاری | تغییر | وضعیت
درآمد عملیاتی | میلیارد تومان | 1840 | 2135 | 16 | مناسب
سود ناخالص | میلیارد تومان | 312 | 368 | 18 | مناسب
تولید کنسانتره | تن | 1210000 | 1260000 | 4 | پایدار
تحقق برنامه | درصد | 96 | 98 | 2 | مناسب
تحویل به‌موقع | درصد | 91 | 94 | 3 | رو به بهبود
توقف اضطراری | ساعت | 610 | 480 | -21 | نیازمند پایش
رضایت مشتری | درصد | 86 | 89 | 3 | مثبت
نیروی انسانی | نفر | 1420 | 1465 | 45 | پایدار`,
};

SAMPLE.pdf = SAMPLE.word;

export const JOB_PROFILE_SAMPLE = `شناسنامه شغلی

## اطلاعات شغل
TABLE:
فیلد | مقدار
عنوان شغل | کارشناس نظارت بهره‌برداری
واحد سازمانی | نظارت و بهره‌برداری
محل خدمت | سایت عملیاتی / محل خدمت کارفرما
رتبه/رده | کارشناس
مدیر مستقیم | مدیر نظارت بهره‌برداری

## هدف شغل
اطمینان از اجرای صحیح تعهدات نظارت بهره‌برداری طبق قرارداد، ثبت انحراف‌ها، و ارائه گزارش قابل اتکا به کارفرما و واحد سازمانی ذی‌ربط؛ به‌گونه‌ای که ایمنی، کیفیت اجرا و انطباق با شرح خدمات حفظ شود.

## وظایف و مسئولیت‌ها
- بررسی اسناد قرارداد، شرح خدمات و الزامات فنی پیش از شروع کار در سایت
- برنامه‌ریزی و انجام بازدیدهای نظارتی دوره‌ای از محل بهره‌برداری
- ثبت وضعیت موجود، انحراف از مشخصات و اقدامات اصلاحی مورد نیاز
- تهیه گزارش نظارت با شواهد، تاریخ، محل و مسئول پیگیری
- هماهنگی با عوامل کارفرما، پیمانکار و واحدهای تخصصی مرتبط
- پایش رعایت دستورالعمل‌های ایمنی و بهره‌برداری در محدوده مسئولیت
- پیگیری رفع مغایرت‌ها تا بسته شدن مورد
- بایگانی مستندات نظارت و تحویل نسخ مورد نیاز کارفرما
- اعلام به‌موقع ریسک عملیاتی یا توقف فعالیت به مدیر مستقیم
- مشارکت در جلسات پیشرفت و ارائه وضعیت نظارت

## اختیارات
- اعلام مغایرت و درخواست اقدام اصلاحی در محدوده شرح خدمات
- توقف موقت فعالیت ناایمن تا تعیین تکلیف مدیر مستقیم، در حد اختیار محول‌شده
- درخواست اطلاعات، نقشه، گزارش و دسترسی لازم از عوامل اجرایی
- پیشنهاد اصلاح روش اجرا یا برنامه بازدید به مدیر مستقیم
- تأیید یا رد انطباق موارد مشاهده‌شده با شرح خدمات، در حد مسئولیت شغلی

## شرایط احراز
### تحصیلات
- حداقل کارشناسی مهندسی مرتبط با حوزه نظارت/بهره‌برداری (مکانیک، برق، صنایع، معدن یا معادل مرتبط)

### سابقه
- حداقل ۳ سال تجربه نظارت، بهره‌برداری یا کار سایت صنعتی

### دانش تخصصی
- آشنایی با قراردادهای نظارت و شرح خدمات
- شناخت فرآیند بهره‌برداری و مستندسازی انحراف
- آگاهی از الزامات ایمنی کار در سایت

### مهارت‌ها
- گزارش‌نویسی فنی و دقیق
- بازدید میدانی و ثبت شواهد
- هماهنگی بین‌واحدی و پیگیری اصلاحیه
- کار با مستندات فنی و بایگانی پرونده نظارت

## ارتباط‌های سازمانی
### درون‌واحدی
- مدیر نظارت بهره‌برداری
- کارشناسان هم‌تیم نظارت و برنامه‌ریزی

### برون‌واحدی
- نماینده کارفرما در سایت
- عوامل پیمانکار / بهره‌بردار
- واحدهای ایمنی، فنی و تدارکات حسب مورد

## شاخص‌های عملکرد شغل
- تکمیل به‌موقع گزارش‌های نظارت طبق برنامه بازدید
- کیفیت و کامل بودن مستندات (محل، تاریخ، شواهد، اقدام)
- درصد مغایرت‌های پیگیری‌شده تا بسته شدن
- زمان اعلام انحراف‌های ایمنی یا توقف
- میزان انطباق بازدیدها با شرح خدمات قرارداد

## شرایط محیطی و الزامات خاص
- حضور در سایت عملیاتی و شرایط محیطی صنعتی
- رعایت الزامات ایمنی فردی و مجوز ورود به محوطه
- امکان مأموریت و بازدید میدانی طبق برنامه قرارداد`;

function parseTableRows(lines: string[]) {
  const rows: string[][] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^HEADERS:\s*/i, "").replace(/^\|/, "").replace(/\|$/, "");
    if (!cleaned.includes("|") || /^[-|:\s]+$/.test(cleaned)) continue;
    rows.push(cleaned.split("|").map((cell) => cleanLine(cell)));
  }
  if (!rows.length) return rows;
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
}

type DocBlock =
  | { type: "title" | "h2" | "h3" | "p" | "li" | "en" | "fa"; text: string }
  | { type: "table"; rows: string[][] };

function parseBilingualBlocks(text: string): DocBlock[] | null {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!/^EN:\s*|^FA:\s*/im.test(raw)) return null;
  const blocks: DocBlock[] = [];
  let mode: "en" | "fa" | "" = "";
  let buf: string[] = [];
  const flush = () => {
    const value = buf.join("\n").trim();
    buf = [];
    if (!value || !mode) return;
    blocks.push({ type: mode, text: cleanLine(value) });
  };
  for (const line of raw.split("\n")) {
    const en = line.match(/^EN(?:GLISH)?:\s*(.*)$/i);
    const fa = line.match(/^FA(?:RSI|PERSIAN)?:\s*(.*)$/i);
    if (en) {
      flush();
      mode = "en";
      buf = [en[1] || ""];
      continue;
    }
    if (fa) {
      flush();
      mode = "fa";
      buf = [fa[1] || ""];
      continue;
    }
    if (mode) buf.push(line);
  }
  flush();
  return blocks.length ? blocks : null;
}

function parseBlocks(text: string): DocBlock[] {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: DocBlock[] = [];
  let first = true;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }
    const isTableStart =
      /^TABLE:/i.test(line) ||
      (line.includes("|") && (lines[i + 1] || "").includes("|"));
    if (isTableStart) {
      if (/^TABLE:/i.test(line)) i += 1;
      const tableLines: string[] = [];
      while (i < lines.length) {
        const row = lines[i].trim();
        if (!row) break;
        if (/^TABLE:/i.test(row) || /^##\s/.test(row) || /^###\s/.test(row)) break;
        if (!row.includes("|") && !/^[-|:\s]+$/.test(row)) break;
        tableLines.push(row);
        i += 1;
      }
      const rows = parseTableRows(tableLines);
      if (rows.length >= 2) blocks.push({ type: "table", rows });
      first = false;
      continue;
    }
    if (first && !line.startsWith("#") && !line.startsWith("-")) {
      blocks.push({ type: "title", text: cleanLine(line) });
      first = false;
      i += 1;
      continue;
    }
    first = false;
    if (line.startsWith("### ")) blocks.push({ type: "h3", text: cleanLine(line.slice(4)) });
    else if (line.startsWith("## ")) blocks.push({ type: "h2", text: cleanLine(line.slice(3)) });
    else if (line.startsWith("# ")) blocks.push({ type: "title", text: cleanLine(line.slice(2)) });
    else if (/^[-*•]\s+/.test(line)) {
      blocks.push({ type: "li", text: cleanLine(line.replace(/^[-*•]\s+/, "")) });
    } else blocks.push({ type: "p", text: cleanLine(line) });
    i += 1;
  }
  return blocks;
}

function parseSlides(text: string) {
  const raw = text.replace(/\r\n/g, "\n").trim();
  const chunks = raw
    .split(/^SLIDE:\s*/im)
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length >= 3 || /^SLIDE:/im.test(raw)) {
    return chunks.map((chunk) => {
      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      const title = cleanLine(lines[0] || "اسلاید");
      const tableLines: string[] = [];
      const bullets: string[] = [];
      const kpis: { label: string; value: string; unit: string; delta: string }[] = [];
      const actions: { priority: string; text: string; owner: string }[] = [];
      let subtitle = "";
      let org = "";
      let inTable = false;
      for (const line of lines.slice(1)) {
        if (/^SUB:\s*/i.test(line)) {
          subtitle = cleanLine(line.replace(/^SUB:\s*/i, ""));
          continue;
        }
        if (/^ORG:\s*/i.test(line)) {
          org = cleanLine(line.replace(/^ORG:\s*/i, ""));
          continue;
        }
        if (/^KPI:\s*/i.test(line)) {
          const parts = line.replace(/^KPI:\s*/i, "").split("|").map(cleanLine);
          kpis.push({
            label: parts[0] || "شاخص",
            value: parts[1] || "",
            unit: parts[2] || "",
            delta: parts[3] || "",
          });
          continue;
        }
        if (/^ACTION:\s*/i.test(line)) {
          const parts = line.replace(/^ACTION:\s*/i, "").split("|").map(cleanLine);
          actions.push({
            priority: parts[0] || "کوتاه‌مدت",
            text: parts[1] || parts[0],
            owner: parts[2] || "",
          });
          continue;
        }
        if (/^TABLE:/i.test(line)) {
          inTable = true;
          continue;
        }
        if (line.includes("|")) {
          inTable = true;
          tableLines.push(line);
          continue;
        }
        if (inTable && !line.includes("|")) inTable = false;
        if (!inTable) bullets.push(cleanLine(line.replace(/^[-*•]\s*/, "")));
      }
      const table = parseTableRows(tableLines);
      if (!kpis.length && table.length >= 2) {
        const heads = table[0].map((h) => h.toLowerCase());
        const unitI = heads.findIndex((h) => h.includes("واحد"));
        const currI = heads.findIndex((h) => h.includes("جاری") || h.includes("مقدار"));
        const deltaI = heads.findIndex((h) => h.includes("تغییر"));
        if (heads.some((h) => h.includes("شاخص")) && currI >= 0) {
          table.slice(1, 7).forEach((row) => {
            kpis.push({
              label: row[0] || "شاخص",
              value: row[currI] || "",
              unit: unitI >= 0 ? row[unitI] || "" : "",
              delta: deltaI >= 0 ? row[deltaI] || "" : "",
            });
          });
        }
      }
      return {
        title,
        subtitle,
        org,
        bullets: bullets.filter(Boolean).slice(0, 6),
        table: table.length >= 2 ? table : undefined,
        kpis: kpis.length ? kpis.slice(0, 6) : undefined,
        actions: actions.length ? actions.slice(0, 6) : undefined,
      };
    });
  }

  const sections = raw.split(/^##\s+/m).map((part) => part.trim()).filter(Boolean);
  if (sections.length > 1) {
    return sections.map((section) => {
      const lines = section.split("\n").map((line) => cleanLine(line)).filter(Boolean);
      return {
        title: lines[0] || "اسلاید",
        subtitle: "",
        org: "",
        bullets: lines
          .slice(1)
          .map((line) => line.replace(/^[-*•]\s*/, ""))
          .filter(Boolean)
          .slice(0, 6),
        table: undefined as string[][] | undefined,
        kpis: undefined as
          | { label: string; value: string; unit: string; delta: string }[]
          | undefined,
        actions: undefined as
          | { priority: string; text: string; owner: string }[]
          | undefined,
      };
    });
  }

  const lines = raw.split("\n").map((line) => cleanLine(line)).filter(Boolean);
  return [
    {
      title: lines[0] || "ارائه",
      subtitle: "",
      org: "",
      bullets: lines.slice(1, 7).map((line) => line.replace(/^[-*•]\s*/, "")),
      table: undefined as string[][] | undefined,
      kpis: undefined as
        | { label: string; value: string; unit: string; delta: string }[]
        | undefined,
      actions: undefined as
        | { priority: string; text: string; owner: string }[]
        | undefined,
    },
  ];
}

function emptySlide(
  title: string,
  bullets: string[],
  extra?: { subtitle?: string }
) {
  return {
    title,
    subtitle: extra?.subtitle || "",
    org: "",
    bullets: bullets.filter(Boolean).slice(0, 6),
    table: undefined as string[][] | undefined,
    kpis: undefined as
      | { label: string; value: string; unit: string; delta: string }[]
      | undefined,
    actions: undefined as
      | { priority: string; text: string; owner: string }[]
      | undefined,
  };
}

export function slidesFromSource(text: string, userText = "") {
  const hay = userText || text;
  const intent = detectDocumentIntent(hay, text);
  const dump = extractAttachedDump(hay) || extractAttachedDump(text);
  const topic =
    (/\bCSCU\b/i.test(hay + dump) ? "CSCU" : "") ||
    intent.topic.replace(/^جزوه-آموزشی-/, "") ||
    firstHeading(dump) ||
    firstHeading(text) ||
    "ارائه";
  const source = dump || String(text || "");
  const sections = source
    .split(/^##\s+/m)
    .map((part) => part.trim())
    .filter(Boolean);
  if (dump && sections.length >= 2) {
    const slides = [
      emptySlide(topic, sourceBullets(sections[0], 4), { subtitle: "جزوه آموزشی" }),
    ];
    sections.slice(0, 10).forEach((section) => {
      const lines = section
        .split("\n")
        .map((line) => cleanLine(line))
        .filter(Boolean);
      const title = cleanLine(lines[0] || topic).slice(0, 70);
      const bullets = sourceBullets(lines.slice(1).join("\n"), 5);
      if (title && title !== topic) {
        slides.push(emptySlide(title, bullets.length ? bullets : [title]));
      }
    });
    return slides.slice(0, 12);
  }
  if (dump) {
    const blocks = source
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 20);
    const slides = [emptySlide(topic, sourceBullets(blocks[0] || dump, 4))];
    blocks.slice(0, 8).forEach((block) => {
      const lines = block
        .split("\n")
        .map((line) => cleanLine(line))
        .filter(Boolean);
      const title = (lines[0] || topic).slice(0, 70);
      if (/^(معرفی|مفاهیم|ابزارها)$/.test(title)) return;
      slides.push(emptySlide(title, sourceBullets(lines.slice(1).join("\n") || block, 5)));
    });
    return slides.slice(0, 10);
  }
  return [emptySlide(topic, [topic])];
}

function sourceBullets(text: string, max = 5) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => cleanLine(line).replace(/^[-*•#\d\.\)\s]+/, ""))
    .filter((line) => line.length > 8 && line.length < 140)
    .filter((line) => !/^(معرفی|مفاهیم|ابزارها|سرفصل‌ها)$/.test(line));
  const unique = [...new Set(lines)];
  return unique.slice(0, max);
}

function parseSheets(text: string) {
  const raw = text.replace(/\r\n/g, "\n");
  const parts = raw.split(/^SHEET:\s*/im).map((p) => p.trim()).filter(Boolean);
  if (parts.length && /HEADERS:/i.test(raw)) {
    return parts.map((part) => {
      const lines = part.split("\n").map((l) => l.trim()).filter(Boolean);
      const name = lines[0].startsWith("HEADERS:") ? "گزارش" : lines[0];
      const tableLines = lines[0].startsWith("HEADERS:") ? lines : lines.slice(1);
      return { name, rows: linesToRows(tableLines.join("\n")) };
    });
  }
  return [{ name: "داده اصلی", rows: linesToRows(raw) }];
}

function linesToRows(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[-|:\s]+$/.test(line));
  const rows: string[][] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^HEADERS:\s*/i, "").replace(/^\|/, "").replace(/\|$/, "");
    if (!cleaned.includes("|")) continue;
    rows.push(cleaned.split("|").map((cell) => cleanLine(cell)));
  }
  if (rows.length < 2) return linesToRows(SAMPLE.xlsx);
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
}

function enRun(
  text: string,
  extra?: { bold?: boolean; size?: number; color?: string }
) {
  return new TextRun({
    text,
    font: {
      ascii: "Calibri",
      hAnsi: "Calibri",
      cs: FA_DOC_FONT,
      eastAsia: "Calibri",
    },
    rightToLeft: false,
    bold: extra?.bold,
    size: extra?.size ?? 22,
    color: extra?.color,
    language: { value: "en-US" },
  });
}

function ltrParagraph(
  text: string,
  extra?: { size?: number; bold?: boolean; after?: number; color?: string }
) {
  return new Paragraph({
    bidirectional: false,
    alignment: AlignmentType.LEFT,
    spacing: { after: extra?.after ?? 80, line: 276 },
    children: [
      enRun(text, {
        bold: extra?.bold,
        size: extra?.size,
        color: extra?.color,
      }),
    ],
  });
}

function rtlParagraph(
  text: string,
  extra?: {
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    size?: number;
    bold?: boolean;
    before?: number;
    after?: number;
    indent?: number;
    color?: string;
  }
) {
  return new Paragraph({
    outlineLevel:
      extra?.heading === HeadingLevel.HEADING_1
        ? 0
        : extra?.heading === HeadingLevel.HEADING_2
          ? 1
          : extra?.heading === HeadingLevel.HEADING_3
            ? 2
            : undefined,
    ...rtlParaExtras(),
    spacing: {
      before: extra?.before,
      after: extra?.after ?? 200,
      line: 276,
    },
    indent: extra?.indent ? { right: extra.indent } : undefined,
    children: [
      faRun(text, {
        bold: extra?.bold,
        size: extra?.size,
        color: extra?.color,
      }),
    ],
  });
}

function emptyRtlParagraph() {
  return new Paragraph({
    ...rtlParaExtras(),
    children: [],
  });
}

function wordTable(rows: string[][], ltr = false, accent = "C9A227") {
  const cols = Math.max(1, rows[0]?.length || 1);
  const tableWidth = 9360;
  const colW = Math.floor(tableWidth / cols);
  const border = { style: BorderStyle.SINGLE, size: 6, color: "D5DDE8" };
  const borders = { top: border, bottom: border, left: border, right: border };
  void accent;
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: Array.from({ length: cols }, () => colW),
    visuallyRightToLeft: !ltr,
    alignment: ltr ? AlignmentType.LEFT : AlignmentType.RIGHT,
    rows: rows.map(
      (row, ri) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                borders,
                width: { size: colW, type: WidthType.DXA },
                shading: {
                  type: ShadingType.CLEAR,
                  fill: ri === 0 ? NAVY : ri % 2 ? "EEF3F8" : "FFFFFF",
                },
                margins: { top: 80, bottom: 80, left: 90, right: 90 },
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    ...(ltr ? ltrParaExtras() : rtlParaExtras()),
                    spacing: { after: 40, line: 276 },
                    children: [
                      ltr
                        ? enRun(cell, {
                            bold: ri === 0,
                            size: 20,
                            color: ri === 0 ? "FFFFFF" : undefined,
                          })
                        : faRun(cell, {
                            bold: ri === 0,
                            size: 20,
                            color: ri === 0 ? "FFFFFF" : undefined,
                          }),
                    ],
                  }),
                ],
              })
          ),
        })
    ),
  });
}

function headingParagraph(
  text: string,
  ltr: boolean,
  extra: {
    heading: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    size: number;
    before?: number;
    after: number;
  }
) {
  if (ltr) {
    return new Paragraph({
      outlineLevel:
        extra.heading === HeadingLevel.HEADING_1
          ? 0
          : extra.heading === HeadingLevel.HEADING_2
            ? 1
            : extra.heading === HeadingLevel.HEADING_3
              ? 2
              : undefined,
      ...ltrParaExtras(),
      spacing: {
        before: extra.before,
        after: extra.after,
        line: 276,
      },
      children: [
        enRun(text, { bold: true, size: extra.size, color: NAVY }),
      ],
    });
  }
  return rtlParagraph(text, {
    heading: extra.heading,
    bold: true,
    size: extra.size,
    before: extra.before,
    after: extra.after,
    color: NAVY,
  });
}

function textToWordChildren(text: string, ltr = false) {
  const children: (Paragraph | Table)[] = [];
  const bilingual = parseBilingualBlocks(text);
  const blocks = bilingual || parseBlocks(text);
  for (const block of blocks) {
    if (block.type === "table") {
      children.push(wordTable(block.rows, ltr));
      children.push(
        ltr
          ? new Paragraph({ ...ltrParaExtras(), children: [] })
          : emptyRtlParagraph()
      );
      continue;
    }
    if (block.type === "title") {
      children.push(
        headingParagraph(block.text, ltr, {
          heading: HeadingLevel.HEADING_1,
          size: 40,
          after: 280,
        })
      );
      continue;
    }
    if (block.type === "h2") {
      children.push(
        headingParagraph(block.text, ltr, {
          heading: HeadingLevel.HEADING_2,
          size: 32,
          before: 280,
          after: 140,
        })
      );
      continue;
    }
    if (block.type === "h3") {
      children.push(
        headingParagraph(block.text, ltr, {
          heading: HeadingLevel.HEADING_3,
          size: 26,
          before: 180,
          after: 100,
        })
      );
      continue;
    }
    if (block.type === "en") {
      children.push(
        ltrParagraph(block.text, { size: 22, after: 60, color: NAVY })
      );
      continue;
    }
    if (block.type === "fa") {
      children.push(rtlParagraph(block.text, { size: 23, after: 200 }));
      continue;
    }
    if (block.type === "li") {
      children.push(
        ltr
          ? ltrParagraph("• " + block.text, { size: 22, after: 80 })
          : rtlParagraph("• " + block.text, { size: 22, after: 80, indent: 360 })
      );
      continue;
    }
    children.push(
      ltr
        ? ltrParagraph(block.text, { size: 22, after: 180 })
        : rtlParagraph(block.text, { size: 23, after: 180 })
    );
  }
  return children;
}

function asciiDigits(value: string) {
  return String(value || "").replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
    if (fa >= 0) return String(fa);
    const ar = "٠١٢٣٤٥٦٧٨٩".indexOf(d);
    return ar >= 0 ? String(ar) : d;
  });
}

function persianDateStamp() {
  try {
    const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) =>
      asciiDigits(parts.find((part) => part.type === type)?.value || "");
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  }
}

function sanitizeFileName(name: string) {
  const cleaned = asciiDigits(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[()[\]{}«»""'']/g, "")
    .replace(/[.,;،؛]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return cleaned || "سند";
}

function firstHeading(text: string) {
  for (const raw of String(text || "").split(/\n+/)) {
    const line = cleanLine(raw)
      .replace(/^#+\s*/, "")
      .replace(/^SLIDE:\s*/i, "")
      .replace(/^SHEET:\s*/i, "")
      .replace(/^(?:EN|FA|ENGLISH|PERSIAN|FARSI):\s*/i, "")
      .trim();
    if (!line) continue;
    if (line === "TABLE:" || line.includes("|")) continue;
    if (/^[-•]/.test(line)) continue;
    if (line.length < 3 || line.length > 70) continue;
    if (/^(فایل آماده|سند زیر|گزارش زیر)/.test(line)) continue;
    return line;
  }
  return "";
}

function detectDocKindLabel(ask: string, body: string) {
  const intent = detectDocumentIntent(ask, body);
  if (intent.type === "training") return "جزوه-آموزشی";
  if (intent.type === "job_profile") return "شناسنامه-شغلی";
  if (intent.type === "project_charter") return "شناسنامه-پروژه";
  if (intent.type === "resume") return "رزومه";
  if (intent.type === "translation") return "ترجمه";
  if (intent.type === "brief") return "خلاصه-مدیریتی";
  if (intent.type === "presentation") return "ارائه";
  if (intent.type === "performance") return "گزارش-عملکرد";
  const t = `${ask}\n${body.slice(0, 1200)}`;
  if (isBilingualAsk(ask) || looksLikeBilingualBody(body)) {
    return "ترجمه";
  }
  if (isJobProfileRequest(ask) || /شناسنامه شغلی|شرح شغل/.test(t)) {
    return "شناسنامه-شغلی";
  }
  if (/شناسنامه پروژه|شناسنامه طرح/.test(t)) return "شناسنامه-پروژه";
  if (/گزارش عملکرد/.test(t)) return "گزارش-عملکرد";
  if (/خلاصه قرارداد|چکیده قرارداد/.test(t)) return "خلاصه-قرارداد";
  if (/متن ارائه|نکته سخنرانی/.test(t)) return "متن-ارائه";
  if (/پروپوزال|طرح پیشنهادی/.test(t)) return "پروپوزال";
  if (/شناسنامه/.test(t)) return "شناسنامه";
  if (/خلاصه/.test(t)) return "خلاصه";
  if (/قرارداد/.test(t)) return "خلاصه-قرارداد";
  if (/گزارش/.test(t)) return "گزارش";
  if (/ارائه|اسلاید/.test(t)) return "ارائه";
  return "";
}

function extractEntityHint(ask: string, body: string) {
  const blob = `${ask}\n${body.slice(0, 2200)}`;
  const patterns = [
    /عنوان شغل\s*[:|]\s*([^\n|]+)/,
    /عنوان پروژه\s*[:|]\s*([^\n|]+)/,
    /نام پروژه\s*[:|]\s*([^\n|]+)/,
    /پروژه\s+([^\n،,]{2,40})/,
    /قرارداد\s+([^\n،,]{2,40})/,
    /(?:کارشناس|مدیر|سرپرست|مهندس)\s+[^\n،,|]{2,36}/,
    /(بهاباد|چادرملو|گل‌گهر|گل گهر|مبارکه|خوزستان|هرمزگان|سیرجان|بافق|اردکان)/,
  ];
  for (const re of patterns) {
    const match = blob.match(re);
    if (!match) continue;
    const value = String(match[1] || match[0] || "")
      .replace(/عنوان شغل|عنوان پروژه|نام پروژه|پروژه|قرارداد/g, "")
      .trim();
    if (value.length >= 2) return value.slice(0, 40);
  }
  return "";
}

function outputBaseName(body: string, userText = "") {
  const intent = detectDocumentIntent(userText || body, body);
  if (intent.type !== "chat" && intent.fileName) {
    return sanitizeFileName(intent.fileName.replace(/\.(docx|pptx|xlsx|pdf)$/i, ""));
  }
  const ask = userAskText(userText || body);
  const kindLabel = detectDocKindLabel(ask, body);
  const heading = firstHeading(body);
  const entity = extractEntityHint(ask, body);

  let raw = "";
  if (heading === "شناسنامه شغلی" && entity) {
    raw = "شناسنامه-شغلی-" + entity;
  } else if (heading === "شناسنامه پروژه" && entity) {
    raw = "شناسنامه-پروژه-" + entity;
  } else if (heading && !/^(گزارش سی‌پی‌جی|شناسنامه شغلی)$/.test(heading)) {
    raw = heading;
  } else if (kindLabel && entity) {
    raw = kindLabel + "-" + entity;
  } else if (heading) {
    raw = heading;
  } else if (kindLabel) {
    raw = kindLabel + "-" + persianDateStamp();
  } else {
    raw = "سند-" + persianDateStamp();
  }
  return sanitizeFileName(raw);
}

function officeLabels(text: string, userText = "") {
  const job =
    isJobProfileRequest(userText || text) ||
    (/شناسنامه شغلی|شرح شغل/.test(text || "") &&
      !looksLikeManagementPerformanceReport(text));
  const base = outputBaseName(text, userText);
  if (job) {
    return {
      title: "شناسنامه شغلی",
      chrome: "",
      base,
      wordName: base + ".docx",
      pdfName: base + ".pdf",
      pptxName: base + ".pptx",
      xlsxName: base + ".xlsx",
    };
  }
  const intent = detectDocumentIntent(userText || text, text);
  if (intent.type === "presentation") {
    const title = intent.topic.replace(/^جزوه-آموزشی-/, "") || firstHeading(text) || "ارائه";
    return {
      title,
      chrome: "",
      base,
      wordName: base + ".docx",
      pdfName: base + ".pdf",
      pptxName: intent.fileName || base + ".pptx",
      xlsxName: base + ".xlsx",
    };
  }
  if (isBilingualAsk(userText) || looksLikeBilingualBody(text)) {
    return {
      title: firstHeading(text) || "Bilingual Contract",
      chrome: "",
      base,
      wordName: base + ".docx",
      pdfName: base + ".pdf",
      pptxName: base + ".pptx",
      xlsxName: base + ".xlsx",
    };
  }
  return {
    title: firstHeading(text) || intent.topic || "سند",
    chrome: "",
    base,
    wordName: base + ".docx",
    pdfName: base + ".pdf",
    pptxName: base + ".pptx",
    xlsxName: base + ".xlsx",
  };
}

function touchRtlSettings(xml: string) {
  if (/<w:themeFontLang\b/.test(xml)) {
    return xml.replace(
      /<w:themeFontLang\b[^/]*\/>/g,
      '<w:themeFontLang w:val="fa-IR" w:eastAsia="fa-IR" w:bidi="fa-IR"/>'
    );
  }
  return xml.replace(
    /<\/w:settings>/,
    '<w:themeFontLang w:val="fa-IR" w:eastAsia="fa-IR" w:bidi="fa-IR"/></w:settings>'
  );
}

function touchRtlSectPr(xml: string) {
  return xml.replace(
    /<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g,
    (_m, attrs, inner) => {
      let body = String(inner)
        .replace(/<w:bidi\b[^/]*\/>/g, "")
        .replace(/<w:rtlGutter\b[^/]*\/>/g, "");
      if (/<w:docGrid\b/.test(body)) {
        body = body.replace(
          /<w:docGrid\b/,
          "<w:bidi/><w:rtlGutter/><w:docGrid"
        );
      } else {
        body += "<w:bidi/><w:rtlGutter/>";
      }
      return `<w:sectPr${attrs}>${body}</w:sectPr>`;
    }
  );
}

async function toRtlDocxBuffer(doc: Document) {
  const raw = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(raw);
  const settings = zip.file("word/settings.xml");
  if (settings) {
    zip.file("word/settings.xml", touchRtlSettings(await settings.async("string")));
  }
  const document = zip.file("word/document.xml");
  if (document) {
    zip.file("word/document.xml", touchRtlSectPr(await document.async("string")));
  }
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return Buffer.from(out);
}

async function buildWord(text: string, userText = ""): Promise<BuiltFile> {
  const body = brandForAsk(text, userText);
  const labels = officeLabels(body, userText);
  const ltr = isEnglishDocument(body, userText);
  const audience = detectDocAudience(userText || body, body);
  const chrome = audienceChrome(audience, ltr);
  const accent = chrome.accent;
  const children = textToWordChildren(body, ltr);

  const headerBorder = {
    style: BorderStyle.SINGLE,
    size: 18,
    color: accent,
    space: 8,
  } as const;

  const headerChildren = ltr
    ? [
        new Paragraph({
          ...ltrParaExtras(),
          spacing: { after: 80 },
          border: { bottom: headerBorder },
          children: [
            enRun(chrome.brand, { bold: true, size: 20, color: NAVY }),
            enRun("   "),
            enRun(chrome.subtitle, { size: 16, color: accent }),
          ],
        }),
      ]
    : [
        new Paragraph({
          ...rtlParaExtras(),
          spacing: { after: 80 },
          border: { bottom: headerBorder },
          children: [
            faRun(chrome.brand, { bold: true, size: 20, color: NAVY }),
            faRun("   "),
            faRun(chrome.subtitle, { size: 16, color: accent }),
          ],
        }),
      ];

  const footerChildren = ltr
    ? [
        new Paragraph({
          ...ltrParaExtras(),
          spacing: { before: 60 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: "D5DDE8", space: 6 },
          },
          children: [
            enRun(chrome.footer, { size: 16, color: "5B6B7C" }),
            enRun("    "),
            new TextRun({
              children: [PageNumber.CURRENT],
              font: EN_FONT,
              size: 16,
              color: "5B6B7C",
            }),
            enRun(" / ", { size: 16, color: "5B6B7C" }),
            new TextRun({
              children: [PageNumber.TOTAL_PAGES],
              font: EN_FONT,
              size: 16,
              color: "5B6B7C",
            }),
            enRun("    CPGAI", { size: 16, color: "5B6B7C" }),
          ],
        }),
      ]
    : [
        new Paragraph({
          ...rtlParaExtras(),
          spacing: { before: 60 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: "D5DDE8", space: 6 },
          },
          children: [
            faRun(chrome.footer, { size: 16, color: "5B6B7C" }),
            faRun("    "),
            new TextRun({
              children: [PageNumber.CURRENT],
              ...RTL_RUN,
              size: 16,
              color: "5B6B7C",
            }),
            faRun(" / ", { size: 16, color: "5B6B7C" }),
            new TextRun({
              children: [PageNumber.TOTAL_PAGES],
              ...RTL_RUN,
              size: 16,
              color: "5B6B7C",
            }),
            faRun("    CPGAI", { size: 16, color: "5B6B7C" }),
          ],
        }),
      ];

  const titlePara = ltr
    ? new Paragraph({
        ...ltrParaExtras(),
        spacing: { before: 80, after: 240 },
        children: [enRun(labels.title, { bold: true, size: 36, color: NAVY })],
      })
    : rtlParagraph(labels.title, {
        bold: true,
        size: 36,
        before: 80,
        after: 240,
        color: NAVY,
      });

  const bodyChildren = children.length ? children : [titlePara];

  const doc = new Document({
    title: labels.title,
    creator: "CPGAI",
    description: chrome.subtitle,
    styles: ltr ? wordStylesLtr() : wordStyles(),
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1400, right: 1134, bottom: 1300, left: 1134 },
          },
        },
        headers: {
          default: new Header({ children: headerChildren }),
        },
        footers: {
          default: new Footer({ children: footerChildren }),
        },
        children: bodyChildren,
      },
    ],
  });

  const buffer = ltr ? await Packer.toBuffer(doc) : await toRtlDocxBuffer(doc);
  return {
    fileName: labels.wordName,
    fileBase64: Buffer.from(buffer).toString("base64"),
    fileMime: MIME.word,
  };
}

async function loadVazir(weight: "Regular" | "Bold") {
  return readFile(
    path.join(process.cwd(), "public", "fonts", `Vazirmatn-${weight}.ttf`)
  );
}


function normalizePdfText(text: string) {
  return String(text || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Reshape Persian/Arabic and reorder to visual LTR for pdf-lib drawText. */
function toPdfVisual(text: string) {
  const normalized = normalizePdfText(text);
  if (!normalized) return "";
  try {
    const reshaped = PersianShaper.convertArabic(normalized);
    const levels = bidi.getEmbeddingLevels(reshaped, "rtl");
    return bidi.getReorderedString(reshaped, levels);
  } catch {
    return normalized;
  }
}

function measurePdf(font: PDFFont, text: string, size: number) {
  const visual = toPdfVisual(text);
  if (!visual) return 0;
  try {
    return font.widthOfTextAtSize(visual, size);
  } catch {
    return visual.length * size * 0.45;
  }
}

function drawLtrText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  leftX: number,
  y: number,
  size: number,
  color: { r: number; g: number; b: number }
) {
  const visual = toPdfVisual(text);
  if (!visual) return 0;
  page.drawText(visual, {
    x: leftX,
    y,
    size,
    font,
    color: rgb(color.r, color.g, color.b),
  });
  return measurePdf(font, text, size);
}

function drawRtlText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  rightX: number,
  y: number,
  size: number,
  color: { r: number; g: number; b: number }
) {
  const visual = toPdfVisual(text);
  if (!visual) return 0;
  let width = 0;
  try {
    width = font.widthOfTextAtSize(visual, size);
  } catch {
    width = visual.length * size * 0.45;
  }
  page.drawText(visual, {
    x: rightX - width,
    y,
    size,
    font,
    color: rgb(color.r, color.g, color.b),
  });
  return width;
}

function wrapLogical(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? current + " " + word : word;
    if (measurePdf(font, trial, size) <= maxWidth) current = trial;
    else {
      if (current) lines.push(current);
      // Hard-break very long tokens
      if (measurePdf(font, word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          const t2 = chunk + ch;
          if (measurePdf(font, t2, size) <= maxWidth) chunk = t2;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [String(text || "")];
}


async function buildPdf(text: string, userText = ""): Promise<BuiltFile> {
  const bodyText = adaptTextForBNazanin(sanitizePdfText(brandForAsk(text, userText)));
  const labels = officeLabels(bodyText, userText);
  const audience = detectDocAudience(userText || bodyText, bodyText);
  const chrome = audienceChrome(audience, isEnglishDocument(bodyText, userText));

  const rawBlocks = parseBlocks(bodyText);
  const blocks: import("@/lib/pdf-chrome").PdfBlock[] = rawBlocks.map((block) => {
    if (block.type === "table") {
      return { type: "table" as const, rows: block.rows };
    }
    if (block.type === "en" || block.type === "fa" || block.type === "p") {
      return { type: "p" as const, text: block.text };
    }
    if (block.type === "title") return { type: "title" as const, text: block.text };
    if (block.type === "h2") return { type: "h2" as const, text: block.text };
    if (block.type === "h3") return { type: "h3" as const, text: block.text };
    return { type: "li" as const, text: block.text };
  });

  let pdfTitle = labels.title;
  let pdfBlocks = blocks;
  if (pdfBlocks[0]?.type === "title") {
    pdfTitle = pdfBlocks[0].text || pdfTitle;
    pdfBlocks = pdfBlocks.slice(1);
  }
  const html = blocksToPdfHtml({
    blocks: pdfBlocks,
    title: pdfTitle,
    brand: chrome.brand,
    footer: chrome.footer,
    audience,
  });
  console.log("PDF_ENGINE buildPdf->chrome");
  const bytes = await renderHtmlToPdfBuffer(html);
  return {
    fileName: labels.pdfName,
    fileBase64: Buffer.from(bytes).toString("base64"),
    fileMime: MIME.pdf,
  };
}

function clipWords(text: string, max: number) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

function clipList(items: string[], maxItems: number, maxWords: number) {
  const out: string[] = [];
  let used = 0;
  for (const item of items) {
    if (out.length >= maxItems || used >= maxWords) break;
    const clipped = clipWords(item, Math.max(3, maxWords - used));
    const count = clipped.split(/\s+/).filter(Boolean).length;
    if (!count) continue;
    out.push(clipped);
    used += count;
  }
  return out;
}

function pptxNum(value: string) {
  const mapped = value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const n = parseFloat(mapped.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function deltaColor(delta: string) {
  if (!delta) return "7A8B9C";
  if (/^\s*-/.test(delta) && !delta.includes("+")) return "2E7D4F";
  if (delta.includes("+") || delta.includes("رشد") || delta.includes("بهبود")) {
    return "2E7D4F";
  }
  return "7A8B9C";
}

async function buildPptx(_text: string, _userText = ""): Promise<BuiltFile> {
  throw new Error("pptx via makePptxDeck only");
}

function toExcelValue(raw: string) {
  const text = raw.trim();
  const mapped = text.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const numeric = mapped.replace(/[٪%,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(numeric) && /[0-9۰-۹]/.test(text)) {
    return Number(numeric);
  }
  return text;
}

function isNumericCol(rows: string[][], colIndex: number) {
  const samples = rows.slice(1).map((row) => row[colIndex] || "");
  const numeric = samples.filter((value) => typeof toExcelValue(value) === "number");
  return numeric.length >= Math.ceil(samples.length * 0.6);
}

function styleSheet(sheet: ExcelJS.Worksheet, rows: string[][], withTotal = false) {
  const headers = rows[0];
  const data = rows.slice(1);
  const numericCols = headers.map((_, index) => isNumericCol(rows, index));
  sheet.views = [
    {
      rightToLeft: true,
      state: "frozen",
      ySplit: 1,
      topLeftCell: "A2",
      activeCell: "A2",
      showGridLines: true,
    },
  ];
  sheet.columns = headers.map((header) => ({
    header,
    width: Math.min(Math.max([...header].length + 10, 16), 38),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { name: FA_DOC_FONT, size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + NAVY } };
    cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF0F2744" } },
    };
  });

  data.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 2);
    excelRow.height = 22;
    row.forEach((value, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = numericCols[colIndex] ? toExcelValue(value) : value;
      cell.font = { name: FA_DOC_FONT, size: 11 };
      cell.alignment = {
        horizontal: "right",
        vertical: "middle",
        readingOrder: "rtl",
        wrapText: true,
      };
      if (typeof cell.value === "number") {
        cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.0";
      }
      if (rowIndex % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + SOFT } };
      }
    });
  });

  if (withTotal && data.length) {
    const totalRowIndex = data.length + 2;
    const totalRow = sheet.getRow(totalRowIndex);
    totalRow.height = 24;
    headers.forEach((_, colIndex) => {
      const cell = totalRow.getCell(colIndex + 1);
      cell.font = { name: FA_DOC_FONT, size: 11, bold: true, color: { argb: "FF" + NAVY } };
      cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8E8F6" } };
      if (colIndex === 0) {
        cell.value = "جمع";
        return;
      }
      if (numericCols[colIndex]) {
        const colLetter = String.fromCharCode(65 + colIndex);
        cell.value = { formula: `SUM(${colLetter}2:${colLetter}${data.length + 1})` };
        cell.numFmt = "#,##0.0";
      }
    });
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
}

async function buildExcel(text: string, userText = ""): Promise<BuiltFile> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CPGAI";
  const parsed = parseSheets(text);
  const sheets = parsed.length >= 2 ? parsed.slice(0, 2) : parsed;

  sheets.forEach((item, index) => {
    const fallback = index === 0 ? "داده خام" : "KPI";
    const name = item.name.slice(0, 28) || fallback;
    const sheet = workbook.addWorksheet(name);
    const withTotal = index === 0 || /خام|داده/i.test(name);
    styleSheet(sheet, item.rows, withTotal && !/KPI|شاخص/i.test(name));
  });

  if (sheets.length === 1) {
    const summary = workbook.addWorksheet("KPI");
    const source = sheets[0].rows;
    const headers = ["شاخص", "واحد", "مقدار", "وضعیت"];
    const dataRows = source.slice(1, 7).map((row) => [
      row[0] || "شاخص",
      row[1] || "",
      row[2] || row[4] || "",
      row[row.length - 1] || "ثبت‌شده",
    ]);
    styleSheet(summary, [headers, ...dataRows], false);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: officeLabels(text, userText).xlsxName,
    fileBase64: Buffer.from(buffer).toString("base64"),
    fileMime: MIME.xlsx,
  };
}

function speakerNoteParagraph(text: string) {
  return new Paragraph({
    ...rtlParaExtras(),
    shading: { type: ShadingType.CLEAR, fill: "F4F7FA" },
    spacing: { before: 60, after: 120 },
    indent: { right: 180, left: 180 },
    children: [
      faRun(text, {
        size: 21,
        color: "3D4F66",
      }),
    ],
  });
}

export async function buildPresentationScriptDoc(
  script: string,
  userText = ""
): Promise<BuiltFile> {
  const children: Paragraph[] = [
    rtlParagraph("متن ارائه حرفه‌ای", {
      heading: HeadingLevel.HEADING_1,
      bold: true,
      size: 40,
      after: 80,
      color: NAVY,
    }),
    rtlParagraph(
      "اسلایدبه‌اسلاید برای سخنران. بولت‌ها روی اسلاید می‌آیند؛ نکته سخنرانی فقط برای گوینده است و تکرار بولت نیست.",
      { size: 20, after: 240, color: "5B7C99" }
    ),
  ];

  const lines = (script || "").replace(/\r\n/g, "\n").split("\n");
  let inNote = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      children.push(emptyRtlParagraph());
      continue;
    }
    if (/^اسلاید\s*[0-9۰-۹]+/.test(line)) {
      inNote = false;
      children.push(
        rtlParagraph(line, {
          heading: HeadingLevel.HEADING_2,
          bold: true,
          size: 30,
          before: 360,
          after: 120,
          color: NAVY,
        })
      );
      continue;
    }
    if (/نکته سخنرانی/.test(line)) {
      inNote = true;
      children.push(
        rtlParagraph("نکته سخنرانی", {
          bold: true,
          size: 22,
          before: 160,
          after: 60,
          color: "5B7C99",
        })
      );
      const rest = line.replace(/^[-•\s]*نکته سخنرانی:?\s*/i, "").trim();
      if (rest && !/^نکته سخنرانی:?$/i.test(rest)) {
        children.push(speakerNoteParagraph(rest));
      }
      continue;
    }
    if (inNote) {
      children.push(speakerNoteParagraph(line.replace(/^[-•\s]+/, "")));
      continue;
    }
    if (
      /^-?\s*عنوان:/.test(line) ||
      /^-?\s*زیرعنوان:/.test(line) ||
      /^-?\s*مخاطب/.test(line) ||
      /^-?\s*بولت/.test(line)
    ) {
      children.push(
        rtlParagraph(line.replace(/^-\s*/, ""), {
          bold: true,
          size: 22,
          after: 80,
          color: NAVY,
        })
      );
      continue;
    }
    if (/^[-•]/.test(line) || /^\s{2,}-/.test(raw)) {
      children.push(
        rtlParagraph("• " + line.replace(/^[-•\s]+/, ""), {
          size: 22,
          indent: 360,
          after: 70,
        })
      );
      continue;
    }
    children.push(rtlParagraph(line.replace(/^-\s*/, ""), { size: 22, after: 140 }));
  }

  const labels = officeLabels(script, userText || "متن ارائه");
  const ltr = isEnglishDocument(script, userText);
  const doc = new Document({
    title: labels.title || "متن ارائه",
    creator: "CPGAI",
    styles: ltr ? wordStylesLtr() : wordStyles(),
    sections: [
      {
        properties: wordSectionProperties(),
        children,
      },
    ],
  });

  const buffer = ltr ? await Packer.toBuffer(doc) : await toRtlDocxBuffer(doc);
  return {
    fileName: labels.wordName,
    fileBase64: Buffer.from(buffer).toString("base64"),
    fileMime: MIME.word,
  };
}

export async function buildOfficeFile(
  kind: FileKind,
  text: string,
  userText = ""
): Promise<BuiltFile> {
  if (kind === "pdf") return buildPdf(text, userText);
  if (kind === "pptx") return buildPptx(text, userText);
  if (kind === "xlsx") return buildExcel(text, userText);
  return buildWord(text, userText);
}
