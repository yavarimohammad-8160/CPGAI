import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { PNG } from "pngjs";
import { readImageDocument } from "@/lib/image-text";

const MAX_PAGES = 45;
const MAX_RAW_CHARS = 70000;
const DIGEST_AFTER = 22000;
const SCAN_USEFUL_MIN = 400;
const SCAN_OCR_PAGES = 10;
export const SCAN_FAIL_NOTE =
  "این PDF اسکن است و متن صفحه کافی استخراج نشد";
export const SCAN_OK_NOTE = "متن از صفحات اسکن‌شده خوانده شد.";

export type ExtractedPdf = {
  totalPages: number;
  usedPages: number;
  truncated: boolean;
  digested: boolean;
  text: string;
  note: string;
};

function usefulLength(text: string) {
  return text.replace(/[\s\-–—_]/g, "").length;
}

export function hasContractSignal(text: string) {
  const t = String(text || "");
  return /article\s+\d+|clause\s+\d+|whereas|this agreement|parties|party of the|contract\s*(no\.?|number|#)|between\s+[A-Z]|ماده\s*\d+|طرفین|شماره\s*قرارداد|قرارداد\s*شماره/i.test(
    t
  );
}

function copyPdfBytes(buffer: Uint8Array) {
  const out = new Uint8Array(buffer.length);
  out.set(buffer);
  return out;
}

export async function extractPdfBuffer(buffer: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(copyPdfBytes(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text || "")]).map((page) =>
    String(page || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  const usedPages = Math.min(pages.length, MAX_PAGES);
  const parts: string[] = [];
  for (let i = 0; i < usedPages; i++) {
    if (!pages[i]) continue;
    parts.push("--- صفحه " + (i + 1) + " ---\n" + pages[i]);
  }

  let extracted = parts.join("\n\n").trim();
  if (extracted.length > MAX_RAW_CHARS) {
    extracted = extracted.slice(0, MAX_RAW_CHARS);
  }

  const truncated = totalPages > usedPages || extracted.length >= MAX_RAW_CHARS;
  let note = "فایل خوانده شد. تعداد صفحات: " + totalPages + ".";
  if (totalPages > usedPages) {
    note += " " + usedPages + " صفحه اول عمیق خوانده شد.";
  }

  return {
    totalPages,
    usedPages,
    truncated,
    digested: false,
    text: extracted,
    note,
  };
}

export async function digestLongPdf(
  apiKey: string,
  raw: string,
  baseUrl: string,
  model = "gpt-4o-mini"
) {
  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 3500,
      messages: [
        {
          role: "system",
          content: [
            "متن یک سند یا پروپوزال را برای ساخت ارائه مدیریتی فشرده کن.",
            "حدس نزن. اگر چیزی در فایل نیست ننویس.",
            "حتماً این‌ها را نگه دار: عنوان و کارفرما، هدف تصمیم، ضرورت و هزینه بی‌عملی، درد و پیامد جدا برای سوخت و ناوگان و آب، راه‌حل، هر ماژول با قابلیت و خروجی و نفع مدیریتی، معماری مرکز پایش، حداقل ۵ شاخص با عدد و واحد، منافع کمی و کیفی، فاز با زمان، ریسک با اقدام کنترلی، پیش‌نیاز شروع، تصمیم مدیریت و اقدام ۳۰ روز.",
            "اگر سند درباره سوخت، ناوگان، آب، پایش، مخزن، تانکر یا مرکز کنترل است این واژه‌ها را حذف نکن.",
            "اعداد، واحدها، نام سایت و نام سامانه را عیناً حفظ کن.",
            "فارسی ساخت‌یافته بنویس. جمله گفتگو ننویس.",
          ].join(" "),
        },
        {
          role: "user",
          content: raw.slice(0, 50000),
        },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  return String(data.choices?.[0]?.message?.content || "").trim();
}

function looksUnreadable(text: string) {
  const t = String(text || "").trim();
  if (hasContractSignal(t)) return false;
  if (usefulLength(t) < SCAN_USEFUL_MIN) return true;
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return t.length > 80 && letters / t.length < 0.28;
}

function pixelsToPngDataUrl(img: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
}) {
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const png = new PNG({ width, height });
  const src = img.data;
  const ch = img.channels;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const si = (sy * img.width + sx) * ch;
      const di = (y * width + x) * 4;
      if (ch === 1) {
        png.data[di] = png.data[di + 1] = png.data[di + 2] = src[si];
        png.data[di + 3] = 255;
      } else if (ch === 3) {
        png.data[di] = src[si];
        png.data[di + 1] = src[si + 1];
        png.data[di + 2] = src[si + 2];
        png.data[di + 3] = 255;
      } else {
        png.data[di] = src[si];
        png.data[di + 1] = src[si + 1];
        png.data[di + 2] = src[si + 2];
        png.data[di + 3] = src[si + 3];
      }
    }
  }
  return "data:image/png;base64," + PNG.sync.write(png).toString("base64");
}

async function pageImageDataUrl(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number
) {
  try {
    const images = await extractImages(pdf, pageNumber);
    const best = [...images].sort(
      (a, b) => b.width * b.height - a.width * a.height
    )[0];
    if (best && best.width >= 180 && best.height >= 180) {
      return pixelsToPngDataUrl({
        data: new Uint8ClampedArray(best.data),
        width: best.width,
        height: best.height,
        channels: best.channels,
      });
    }
  } catch (err) {
    console.log("PDF_PAGE_IMAGE_FAIL", pageNumber, err);
  }
  return "";
}

export async function rasterizePdfPages(buffer: Uint8Array, maxPages = SCAN_OCR_PAGES) {
  const pdf = await getDocumentProxy(copyPdfBytes(buffer));
  const total = pdf.numPages || 1;
  const used = Math.min(total, maxPages);
  const urls: string[] = [];
  for (let page = 1; page <= used; page += 1) {
    const url = await pageImageDataUrl(pdf, page);
    if (url) urls.push(url);
  }
  return { urls, totalPages: total };
}

export async function ocrPdfPages(buffer: Uint8Array, apiKey: string) {
  const { urls, totalPages } = await rasterizePdfPages(buffer, SCAN_OCR_PAGES);
  console.log("PDF_SCAN_OCR", { pages: urls.length, totalPages });
  if (!urls.length) {
    return { text: "", pages: totalPages, weak: true };
  }
  const parts: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const ocr = await readImageDocument(apiKey, urls[i]);
    const text = (ocr.text || "").trim();
    if (text.length >= 12) {
      parts.push("--- صفحه " + (i + 1) + " ---\n" + text);
    }
  }
  const text = parts.join("\n\n").trim();
  return {
    text,
    pages: totalPages,
    weak: looksUnreadable(text),
  };
}

export { DIGEST_AFTER, usefulLength, looksUnreadable, SCAN_USEFUL_MIN };
