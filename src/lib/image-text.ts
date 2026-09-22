import {
  detectFileKind,
  isHelpOrSystemAsk,
  isJobProfileRequest,
} from "@/lib/office";
import { isPresentationScriptRequest } from "@/lib/presentation-script";
import { findLastUserImages, isImageWorkAsk } from "@/lib/image-work";

export type ImageReadResult = {
  kind: "document" | "scene" | "unknown";
  text: string;
  unclear: string;
};

const AVALAI_BASE = "https://api.avalai.ir/v1";

const DOCUMENT_ASK_KEYS = [
  "جزوه",
  "آموزشی",
  "شناسنامه شغلی",
  "شناسنامه شغل",
  "شرح شغل",
  "شرح وظایف",
  "خلاصه",
  "گزارش",
  "تحلیل",
  "استخراج",
  "متن را بخوان",
  "متن تصویر",
  "از روی این تصویر",
  "از روی این عکس",
  "از روی تصویر",
  "از روی عکس",
  "از روی این سند",
  "این صفحه",
  "قرارداد",
  "پروپوزال",
  "طرح پیشنهادی",
  "job profile",
  "job description",
];

const OCR_PROMPT = [
  "این تصویر را بررسی کن.",
  "اگر سند، قرارداد، فرم، نامه، جدول، شرح خدمات، شرح وظایف، اسکرین‌شات متن، یا صفحه اسکن‌شده است:",
  "- تمام متن قابل‌خواندن را به همان زبان اصلی استخراج کن.",
  "- متن فارسی را کامل و راست‌به‌چپ بنویس.",
  "- عنوان‌ها، بندها، فهرست‌ها و جدول‌ها را تا حد ممکن حفظ کن.",
  "- اگر کلمه‌ای ناخوانا بود همان‌جا [در تصویر ناخوانا] بگذار و حدس نزن.",
  "- هرگز نگو نمی‌توانی عکس را بخوانی.",
  "خروجی دقیقاً با این قالب:",
  "TYPE: DOCUMENT",
  "TEXT:",
  "(متن استخراج‌شده)",
  "UNCLEAR:",
  "(بخش‌های ناخوانا؛ اگر نبود بنویس هیچ)",
  "",
  "اگر عکس منظره، چهره، شیء یا صحنه بدون متن سندی است:",
  "TYPE: SCENE",
].join("\n");

export function isDocumentWorkRequest(text: string) {
  if (isImageWorkAsk(text)) return false;
  if (isHelpOrSystemAsk(text)) return false;
  if (isJobProfileRequest(text)) return true;
  if (isPresentationScriptRequest(text)) return true;
  if (detectFileKind(text)) return true;
  const t = (text || "").split("محتوای فایل:")[0].split("نام فایل:")[0];
  const lower = t.toLowerCase();
  return DOCUMENT_ASK_KEYS.some((key) =>
    key === key.toLowerCase() ? lower.includes(key) : t.includes(key)
  );
}

export function findLastUserImage(
  messages: { role?: string; image?: string; images?: string[] }[]
) {
  const imgs = findLastUserImages(messages);
  return imgs[0] || "";
}

export function attachImageSource(
  userText: string,
  extracted: string,
  unclear = ""
) {
  const ask = (userText || "").trim() || "از روی این تصویر سند را بساز.";
  const unclearBlock =
    unclear && !/^هیچ/.test(unclear.trim())
      ? "\n\nبخش‌های نامشخص تصویر:\n" + unclear.trim()
      : "";

  if (/محتوای فایل:/.test(ask)) {
    return (
      ask +
      "\n\nمتن استخراج‌شده از تصویر:\n" +
      extracted.trim() +
      unclearBlock
    );
  }

  return [
    ask,
    "",
    "نام فایل: تصویر پیوست",
    "متن تصویر خوانده شد.",
    "محتوای فایل:",
    extracted.trim(),
  ].join("\n") + unclearBlock;
}

function parseImageRead(raw: string): ImageReadResult {
  const text = String(raw || "").trim();
  if (!text) return { kind: "unknown", text: "", unclear: "" };
  if (
    text.length < 220 &&
    /نمی‌توانم|نمي‌توانم|cannot (read|see)|can't (read|see)|unable to (read|view|access)/i.test(
      text
    )
  ) {
    return { kind: "unknown", text: "", unclear: "" };
  }

  const scene = /TYPE:\s*SCENE/i.test(text);
  const body =
    text.match(/TEXT:\s*([\s\S]*?)(?:UNCLEAR:|$)/i)?.[1] || "";
  const unclear =
    text.match(/UNCLEAR:\s*([\s\S]*)$/i)?.[1]?.trim() || "";
  const extracted = (
    body ||
    text.replace(/^TYPE:\s*(DOCUMENT|SCENE)\s*/i, "")
  ).trim();
  const cleaned = extracted
    .replace(/^TYPE:\s*(DOCUMENT|SCENE)\s*/i, "")
    .replace(/^TEXT:\s*/i, "")
    .trim();

  if (scene && cleaned.length < 80) {
    return { kind: "scene", text: "", unclear: "" };
  }
  if (cleaned.length >= 20) {
    return {
      kind: "document",
      text: cleaned,
      unclear: /^هیچ/.test(unclear) ? "" : unclear,
    };
  }
  if (scene) return { kind: "scene", text: "", unclear: "" };
  return { kind: "unknown", text: cleaned, unclear };
}

async function visionRead(
  apiKey: string,
  image: string,
  model: string
) {
  const response = await fetch(AVALAI_BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "متن داخل تصویر سند را استخراج می‌کنی. هرگز نگو نمی‌توانی عکس را بخوانی.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            {
              type: "image_url",
              image_url: { url: image, detail: "high" },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(70000),
  });
  const data = await response.json().catch(() => ({}));
  return String(data.choices?.[0]?.message?.content || "").trim();
}

export async function readImageDocument(
  apiKey: string,
  image: string
): Promise<ImageReadResult> {
  for (const model of ["gpt-4o-mini", "gpt-4o"]) {
    try {
      const raw = await visionRead(apiKey, image, model);
      const parsed = parseImageRead(raw);
      if (parsed.kind === "document" && parsed.text.length >= 20) return parsed;
      if (parsed.kind === "scene") return parsed;
      if (parsed.text.length >= 20) {
        return { kind: "document", text: parsed.text, unclear: parsed.unclear };
      }
    } catch {
      // try next model
    }
  }
  return { kind: "unknown", text: "", unclear: "" };
}
