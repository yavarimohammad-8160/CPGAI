import { sourceTextOnly, userAskOnly } from "@/lib/text-to-slides";
import {
  buildSmartFileName,
  detectDocAudience,
  extractExplicitFileName,
  type DocAudience,
} from "@/lib/file-style";

export type WorkType =
  | "resume"
  | "job_profile"
  | "project_charter"
  | "training"
  | "translation"
  | "presentation"
  | "brief"
  | "performance"
  | "from_source"
  | "chat"
  | "image";

export type FormatAsk = "pdf" | "docx" | "pptx" | "xlsx" | "chat" | "image";

export type FileKind = "word" | "pdf" | "pptx" | "xlsx";

export type DocumentIntent = {
  type: WorkType;
  format: FormatAsk;
  topic: string;
  fileName: string;
  sourceChars: number;
  userAsk: string;
  sourceText: string;
  kind: FileKind;
  convertSame: boolean;
  audience: DocAudience;
  explicitName: string;
};

const QUALITY =
  /قوی|خوشگل|زیبا|شیک|حرفه‌ای|حرفه ای|عالی|کامل|دقیق|مدون|جذاب|آماده|بفرست|بصورت|به‌صورت|گفتم|لاکچری|لوکس/g;

const FORBIDDEN_NAME =
  /آماده-شده-بصورت-بفرست|گفتم-فایل-بفرست|گزارش-عملکرد-سالانه-نمونه/;

function fa(s: string) {
  return String(s || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
}

export function splitAskAndSource(full: string) {
  const userAsk = fa(userAskOnly(full) || "").trim();
  const sourceText = sourceTextOnly(full).trim();
  return { userAsk, sourceText };
}

function isHelpAsk(ask: string) {
  const t = fa(ask);
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

export function wantsFileOutput(ask: string) {
  // Only the current user's request authorizes a downloadable artifact.
  // Attached content, code samples, and format names alone are not requests.
  const t = fa(userAskOnly(ask)).replace(/```[\s\S]*?```|`[^`]*`/g, " ")
    .replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:show|write|give|explain)\b.{0,25}\b(?:code|command|script)\b|(?:کد|دستور ترمینال|دستورات ترمینال).{0,60}(?:بنویس|بده|توضیح)/i.test(t)) return false;
  if (/فایل.{0,30}(?:نمی خواهم|نمی خوام|نمیخوام|نساز|نده|نفرست|لازم نیست)|بدون فایل|فقط.{0,20}(?:متن|مارک داون|مارکداون|داخل چت)|\b(?:do not|don't|no)\b.{0,30}\b(?:file|docx|pptx|document)\b|\b(?:plain text|markdown only|text only)\b/i.test(t)) return false;
  if (/چطور|چگونه|نحوه|طرز|\b(?:how (?:do|can|to)|tutorial|troubleshoot)\b/i.test(t) &&
      !/(?:برام|برای من).{0,50}(?:بساز|بفرست|بده|ایجاد کن|تولید کن)|\b(?:create|generate|make|send) me\b/i.test(t)) return false;
  const format = "(?:\\b(?:docx|pptx|pdf|word|powerpoint|xlsx|excel)\\b|پی دی اف|(?<![آ-ی])ورد(?![آ-ی])|پاور\\s*پوینت|اکسل)";
  const artifact = "(?:" + format + "|فایل|سند|داکیومنت|\\b(?:file|document|presentation|slide deck)\\b)";
  const action = "(?:بساز|بده|بفرست|دانلود|ایجاد کن|تولید کن|تهیه کن|آماده کن|ذخیره کن|تبدیل کن|می خواهم|می خوام|میخوام|\\b(?:create|generate|make|build|export|download|send|save|convert)\\b)";
  // Reading or explaining an existing file does not request a new output.
  if (/توضیح بده|شرح بده|راهنمایی بده|بررسی کن|خلاصه کن|تحلیل کن|ترجمه کن|\b(?:explain|review|summarize|translate)\b/i.test(t) &&
      !new RegExp("(?:بساز|بفرست|دانلود|ایجاد کن|تولید کن|ذخیره کن|\\b(?:export|download|save|create|generate)\\b)|(?:خروجی|در قالب|به صورت)\\s*" + format, "i").test(t)) return false;
  return new RegExp(artifact + ".{0,100}" + action + "|" + action + ".{0,100}" + artifact, "i").test(t) ||
    new RegExp(format + "\\s*کن", "i").test(t) ||
    new RegExp("(?:به صورت|در قالب|با فرمت|خروجی|نسخه|as (?:a |an )?)\\s*" + format, "i").test(t);
}

function isImageOnlyAsk(ask: string, sourceChars: number) {
  const t = fa(ask);
  if (wantsFileOutput(t) && /پاورپوینت|pptx|اسلاید|ارائه|ورد|word|pdf|docx/.test(t)) {
    return false;
  }
  if (sourceChars > 80 && /از روی این فایل|از این فایل|از روی فایل/.test(t)) {
    return false;
  }
  return /(?:یه |یک )?(?:عکس|تصویر).{0,40}(?:بده|بساز|بکش)|ویرایش (?:عکس|تصویر)|همین عکس|این عکس را/.test(
    t
  );
}

export function isConvertSame(ask: string) {
  const t = fa(ask);
  return /همین (?:را|رو)|همین فایل|همین سند|همین ورد|همین متن|تبدیل به|(?:pdf|پی‌دی‌اف|پی\s*دی\s*اف)\s*کن|ورد کن|پاورپوینت کن/.test(
    t
  );
}

function detectFormat(ask: string, type: WorkType): FormatAsk {
  const t = fa(ask);
  if (type === "image") return "image";
  if (type === "presentation") return "pptx";
  if (/متن ارائه|اسکریپت سخنرانی/.test(t) && !/پاورپوینت|pptx|اسلاید/.test(t)) {
    return "docx";
  }
  if (/pptx|powerpoint|پاورپوینت|پاور\s*پوینت/i.test(t)) return "pptx";
  if (/اسلاید/.test(t) && !/اسلایدبندی|نکته سخنرانی/.test(t)) return "pptx";
  if (
    /ارائه.{0,48}(بده|بساز|کن|آماده|عکس|تصویر|بصری|اینفوگرافیک)/.test(t) ||
    /(عکس|تصویر|بصری|اینفوگرافیک).{0,24}(ارائه|پاورپوینت|اسلاید)/.test(t)
  ) {
    return "pptx";
  }
  if (/\bpdf\b|پی‌دی‌اف|پی\s*دی\s*اف/i.test(t)) return "pdf";
  if (/xlsx|\bexcel\b|اکسل/.test(t)) return "xlsx";
  if (/docx|\bword\b|فایل\s*ورد|خروجی\s*ورد|(^|[^\u0600-\u06FF])ورد(?=[^\u0600-\u06FF]|$)/i.test(t)) {
    return "docx";
  }
  if (type === "chat") return "chat";
  return "docx";
}

function detectType(ask: string, source: string): WorkType {
  const t = fa(ask);
  const src = fa(source).slice(0, 2500);
  const blob = t + "\n" + src;

  if (isHelpAsk(t) && !wantsFileOutput(t)) return "chat";
  if (isImageOnlyAsk(t, src.length)) return "image";

  if (
    /پاورپوینت|pptx|powerpoint|اسلاید/i.test(t) ||
    /ارائه.{0,48}(بده|بساز|کن|آماده|عکس|تصویر|بصری|اینفوگرافیک)/.test(t) ||
    /(عکس|تصویر|بصری|اینفوگرافیک).{0,24}(ارائه|پاورپوینت|اسلاید)/.test(t)
  ) {
    if (!/متن ارائه|اسکریپت سخنرانی|نکته سخنرانی/.test(t)) return "presentation";
  }

  if (/ترجمه|دو\s*زبانه|دوزبانه|bilingual|انگلیسی با ترجمه/i.test(t)) {
    return "translation";
  }
  if (/\bresume\b|\bcv\b|رزومه|بازار کار|curriculum vitae/i.test(blob)) {
    return "resume";
  }
  if (/شناسنامه\s*شغلی|شناسنامه\s*شغل|شرح\s*شغل|job\s*profile|job\s*description/i.test(blob)) {
    return "job_profile";
  }
  if (/شناسنامه\s*پروژه|منشور\s*پروژه|project\s*charter|شناسنامه\s*طرح/i.test(blob)) {
    return "project_charter";
  }

  const trainAsk = /جزوه|سرفصل\s*تدریس|فراگیر|مدرس|دوره(?:\s*آموزش)?|کلاس|آموزش(?:ی)?|handbook|courseware/i.test(
    t
  );
  const trainSrc =
    /جزوه|handbook|courseware|\bCSCU\b|سرفصل\s*تدریس|certified\s+secure/i.test(src);
  if (trainAsk || (trainSrc && wantsFileOutput(t) && !/قرارداد|پروپوزال|شناسنامه/.test(t))) {
    return "training";
  }

  if (/خلاصه\s*مدیریتی|executive\s*summary|چکیده\s*مدیریتی/i.test(t)) {
    if (!/گزارش\s*عملکرد|عملکرد\s*سالانه/.test(t)) return "brief";
  }

  const perfAsk = /گزارش\s*عملکرد|عملکرد\s*سالانه/i.test(t);
  const perfSrc =
    /گزارش عملکرد سالانه|درآمد عملیاتی|تحقق برنامه تولید/.test(src) && src.length > 120;
  if (perfAsk) return "performance";
  if (
    perfSrc &&
    /گزارش|kpi|عملکرد/i.test(t) &&
    !/شناسنامه|جزوه|رزومه|ترجمه|ارائه/.test(t)
  ) {
    return "performance";
  }

  if (
    src.length > 40 &&
    /قرارداد|پروپوزال|agreement|contract|proposal|whereas|article\s+\d+/i.test(blob) &&
    wantsFileOutput(t)
  ) {
    return "from_source";
  }
  if (wantsFileOutput(t)) return "from_source";
  return "chat";
}

function firstSourceHeading(source: string) {
  const lines = String(source || "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length < 2 || line.length > 70) continue;
    if (isJunkTopic(line) && line.length < 40) continue;
    if (/^TABLE:|فایل خوانده شد|نام فایل:|دستور کاربر/.test(line)) continue;
    return line.slice(0, 48);
  }
  return "";
}

function personOrCourse(source: string, ask: string) {
  const hay = source + "\n" + ask;
  if (/\bCSCU\b/i.test(hay)) return "CSCU";
  const acr = source.match(/\b[A-Z]{3,8}\b/);
  if (acr && !/PDF|DOCX|PPTX|HTTP|JPEG|PNG|HTML/.test(acr[0])) return acr[0];
  const person = source.match(
    /(?:^|\n)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*(?:\n|$)/
  );
  if (person) return person[1].slice(0, 40);
  const faName = source.match(/(?:نام\s*[:：]\s*)([^\n]{3,40})/);
  if (faName) return faName[1].trim();
  return "";
}

const FILLER_TOKEN =
  /^(بله|تمام|چیزهای?|دیگه|دیگر|فکر|میکن[یی]د?|لازمه|لازم|برام|بفرست|قالب|بصورت|به‌صورت|آماده|گفتم|فایل|کن|را|رو|این|همین|یک|یه|از|با|برای|که|تا|هم|یا|و|لطفا|خواهشا|خروجی|دانلود|بده|بساز|ورد|pdf|pptx|پاورپوینت|اسلاید|ارائه|docx|word|xlsx|اکسل|پی‌دی‌اف)$/i;

function topicalTokens(raw: string) {
  const t = fa(raw)
    .replace(QUALITY, " ")
    .replace(
      /جزوه(?:\s*آموزشی)?|آموزشی|کلاس|دوره|مدرس|شناسنامه(?:\s*شغلی|\s*شغل|\s*پروژه)?|شرح\s*شغل|منشور\s*پروژه|ترجمه|دوزبانه|بازار\s*کار|پاورپوینت|اسلاید|pptx|powerpoint|docx|\bword\b|xlsx|اکسل|بده|بساز|دانلود|خروجی|لینک|رزومه|\bresume\b|\bcv\b|سازمانی|عمومی|لاکچری|لوکس/gi,
      " "
    )
    .replace(/[«»"'():،,؟?!.]/g, " ");
  const out: string[] = [];
  for (const w of t.split(/[\s\-]+/).filter(Boolean)) {
    if (w.length < 2) continue;
    if (FILLER_TOKEN.test(w)) continue;
    if (
      /قوی|خوشگل|زیبا|شیک|حرفه‌ای|حرفه ای|عالی|کامل|دقیق|مدون|جذاب|آماده|بفرست|بصورت|گفتم|لاکچری|لوکس/.test(
        w
      )
    ) {
      continue;
    }
    if (!out.includes(w)) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

function cleanTopic(raw: string) {
  const tokens = topicalTokens(raw);
  const t = tokens.join(" ").trim();
  if (!t || isJunkTopic(t)) return "";
  return t.slice(0, 48);
}

function sanitizeFileName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function isJunkTopic(value: string) {
  const s = sanitizeFileName(fa(value));
  if (!s) return true;
  if (FORBIDDEN_NAME.test(s)) return true;
  const stripped = s
    .replace(
      /آماده|شده|بصورت|به‌صورت|بفرست|گفتم|فایل|قوی|خوشگل|زیبا|حرفه‌ای|حرفه-ای|کامل|دقیق|مدون|نمونه|سالانه|لاکچری|لوکس/g,
      ""
    )
    .replace(/-/g, "");
  return !stripped;
}

export function formatToKind(format: FormatAsk): FileKind {
  if (format === "pptx") return "pptx";
  if (format === "pdf") return "pdf";
  if (format === "xlsx") return "xlsx";
  return "word";
}

export function intentOutputKind(intent: DocumentIntent): FileKind | null {
  if (intent.format === "chat" || intent.format === "image") return null;
  if (intent.type === "chat" || intent.type === "image") return null;
  return formatToKind(intent.format);
}

export function resolveIntent(fullText: string, extraBody = ""): DocumentIntent {
  const { userAsk, sourceText: extracted } = splitAskAndSource(fullText);
  const sourceText = extracted || (extraBody.length > 80 ? extraBody : "");
  const sourceChars = sourceText.length;
  let type = detectType(userAsk, sourceText);
  let format = detectFormat(userAsk, type);
  const explicitFileOutput = wantsFileOutput(userAsk);
  const convertSame = explicitFileOutput && isConvertSame(userAsk);
  const audience = detectDocAudience(userAsk, sourceText);
  const explicitName = extractExplicitFileName(userAsk);

  if (convertSame && format === "chat") format = "pdf";
  if (type === "presentation") format = "pptx";
  if (type === "image") format = "image";
  if (type === "chat" && (wantsFileOutput(userAsk) || convertSame)) {
    type = "from_source";
    if (format === "chat") format = "docx";
  }
  if (type === "chat" && format !== "chat" && format !== "image") {
    type = "from_source";
  }

  if (!explicitFileOutput && type !== "image") {
    type = "chat";
    format = "chat";
  }

  const fromSrc =
    personOrCourse(sourceText, userAsk) || firstSourceHeading(sourceText);
  const rawName = explicitName || userAsk.replace(/\s+/g, " ").trim().slice(0, 80);
  let topic = cleanTopic(userAsk);
  if (explicitName) {
    const fromExplicit = cleanTopic(explicitName) || "";
    if (fromExplicit) topic = fromExplicit.slice(0, 48);
  }
  if (!topic || isJunkTopic(topic)) topic = cleanTopic(fromSrc) || fromSrc;
  if (!topic) topic = cleanTopic(firstSourceHeading(sourceText)) || firstSourceHeading(sourceText);
  if (type === "training" && /\bCSCU\b/i.test(userAsk + sourceText)) topic = "CSCU";
  if (type === "presentation" && /\bCSCU\b/i.test(userAsk + sourceText)) topic = "CSCU";
  if (!topic) topic = type === "chat" || type === "image" ? "" : "سند";
  if (isJunkTopic(topic)) topic = type === "performance" ? "گزارش-عملکرد" : "سند";
  topic = topicalTokens(topic).slice(0, 6).join("-") || topic;

  let fileName = "";
  if (format !== "chat" && format !== "image") {
    fileName = buildSmartFileName({
      type,
      format,
      topic,
      audience,
      explicitName: explicitName || undefined,
    });
    console.log("FILE_NAME_SANITIZE", { raw: rawName, clean: fileName });
  }

  return {
    type,
    format,
    topic,
    fileName,
    sourceChars,
    userAsk,
    sourceText,
    kind: formatToKind(format),
    convertSame,
    audience,
    explicitName,
  };
}
