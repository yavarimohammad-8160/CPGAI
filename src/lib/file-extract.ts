import JSZip from "jszip";
import ExcelJS from "exceljs";
import {
  extractPdfBuffer,
  hasContractSignal,
  usefulLength,
} from "@/lib/pdf-extract";

export const LIMITED_EXTRACT_NOTE =
  "این فرمت برای استخراج متن پشتیبانی محدود دارد";

export const WEAK_EXTRACT_NOTE = "بخشی از متن فایل خوانا نبود";
export const READ_OK_NOTE = "فایل خوانده شد";

export type ExtractResult = {
  text: string;
  note: string;
  weak: boolean;
  limited: boolean;
  pages?: number;
  scanned?: boolean;
};

const MAX_CHARS = 70000;

function extOf(name: string) {
  const m = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function collapse(text: string) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clip(text: string) {
  const t = collapse(text);
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t;
}

function isWeakText(text: string) {
  const t = collapse(text);
  if (usefulLength(t) < 40) return true;
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return t.length > 80 && letters / t.length < 0.25;
}

function xmlTagText(xml: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g");
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const value = decodeXml(match[1] || "");
    if (value.trim()) parts.push(value);
  }
  return parts.join(" ");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function unzipText(bytes: Uint8Array, path: string) {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  if (!file) return "";
  return file.async("string");
}

async function extractDocx(bytes: Uint8Array) {
  const xml = await unzipText(bytes, "word/document.xml");
  return clip(xmlTagText(xml, "w:t").replace(/  +/g, " "));
}

async function extractPptx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
      return na - nb;
    });
  const parts: string[] = [];
  for (const name of names) {
    const xml = await zip.file(name)?.async("string");
    const text = collapse(xmlTagText(xml || "", "a:t"));
    if (text) parts.push(text);
  }
  return clip(parts.join("\n\n"));
}

async function extractXlsx(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    parts.push("SHEET: " + sheet.name);
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = values
        .map((cell) => {
          if (cell == null) return "";
          if (typeof cell === "object" && "text" in (cell as object)) {
            return String((cell as { text?: string }).text || "");
          }
          if (typeof cell === "object" && "result" in (cell as object)) {
            return String((cell as { result?: unknown }).result ?? "");
          }
          return String(cell);
        })
        .join(" | ")
        .trim();
      if (line) parts.push(line);
    });
  });
  return clip(parts.join("\n"));
}

function extractRtf(raw: string) {
  let text = String(raw || "").replace(/\r\n/g, "\n");
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, (m) => {
    const code = parseInt(m.slice(2), 16);
    return code >= 32 ? String.fromCharCode(code) : " ";
  });
  text = text.replace(/\\u(-?\d+)\??/g, (_, n) => {
    let code = Number(n);
    if (code < 0) code += 65536;
    return code ? String.fromCharCode(code) : " ";
  });
  text = text
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n");
  return clip(text);
}

function extractBinaryText(bytes: Uint8Array) {
  const ascii: string[] = [];
  let run = "";
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127)) {
      run += String.fromCharCode(code);
    } else {
      if (run.trim().length >= 5) ascii.push(run.trim());
      run = "";
    }
  }
  if (run.trim().length >= 5) ascii.push(run.trim());

  const utf16: string[] = [];
  let wide = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 0xd800)) {
      wide += String.fromCharCode(code);
    } else {
      if (wide.trim().length >= 6) utf16.push(wide.trim());
      wide = "";
    }
  }
  if (wide.trim().length >= 6) utf16.push(wide.trim());

  const merged = [...utf16, ...ascii]
    .filter((chunk) => /[\p{L}\p{N}]/u.test(chunk))
    .join("\n");
  return clip(merged);
}

function looksMostlyText(bytes: Uint8Array) {
  const n = Math.min(bytes.length, 1200);
  if (!n) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const code = bytes[i];
    if (code === 0) return false;
    if (code < 9 || (code > 13 && code < 32)) bad += 1;
  }
  return bad / n < 0.08;
}

function result(text: string, extra?: Partial<ExtractResult>): ExtractResult {
  const clipped = clip(text);
  const limited = !!extra?.limited;
  const weak = limited || extra?.weak || isWeakText(clipped);
  const note = limited
    ? LIMITED_EXTRACT_NOTE
    : weak
      ? WEAK_EXTRACT_NOTE
      : extra?.note || READ_OK_NOTE;
  return {
    text: clipped,
    note,
    weak,
    limited,
    pages: extra?.pages,
    scanned: extra?.scanned,
  };
}

export async function extractUploadedBytes(
  name: string,
  type: string,
  bytes: Uint8Array
): Promise<ExtractResult> {
  const ext = extOf(name);
  const mime = String(type || "").toLowerCase();

  try {
    if (ext === "psd" || mime.includes("photoshop")) {
      const text = extractBinaryText(bytes);
      return result(isWeakText(text) ? "" : text, { limited: true });
    }

    if (ext === "pdf" || mime.includes("pdf")) {
      const extracted = await extractPdfBuffer(bytes);
      const useful = usefulLength(extracted.text);
      const contract = hasContractSignal(extracted.text);
      const weak = !contract && (useful < 400 || isWeakText(extracted.text));
      return result(extracted.text, {
        weak,
        scanned: useful < 400 || isWeakText(extracted.text),
        pages: extracted.totalPages,
        note: weak ? WEAK_EXTRACT_NOTE : extracted.note || READ_OK_NOTE,
      });
    }

    if (
      ext === "docx" ||
      mime.includes("wordprocessingml.document")
    ) {
      return result(await extractDocx(bytes));
    }

    if (ext === "doc" || mime === "application/msword") {
      const text = extractBinaryText(bytes);
      return result(text, { weak: isWeakText(text) });
    }

    if (
      ext === "pptx" ||
      mime.includes("presentationml.presentation")
    ) {
      return result(await extractPptx(bytes));
    }

    if (ext === "ppt" || mime === "application/vnd.ms-powerpoint") {
      const text = extractBinaryText(bytes);
      return result(text, {
        limited: isWeakText(text),
        weak: isWeakText(text),
      });
    }

    if (
      ext === "xlsx" ||
      mime.includes("spreadsheetml.sheet")
    ) {
      return result(await extractXlsx(bytes));
    }

    if (ext === "xls" || mime === "application/vnd.ms-excel") {
      try {
        return result(await extractXlsx(bytes));
      } catch {
        const text = extractBinaryText(bytes);
        return result(text, { limited: isWeakText(text) });
      }
    }

    if (ext === "rtf" || mime.includes("rtf")) {
      const raw = Buffer.from(bytes).toString("utf8");
      return result(extractRtf(raw));
    }

    if (
      ext === "json" ||
      mime.includes("json")
    ) {
      const raw = Buffer.from(bytes).toString("utf8");
      try {
        return result(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        return result(raw);
      }
    }

    if (
      ["txt", "csv", "md", "log"].includes(ext) ||
      mime.startsWith("text/")
    ) {
      return result(Buffer.from(bytes).toString("utf8"));
    }

    if (["png", "jpg", "jpeg", "webp"].includes(ext) || mime.startsWith("image/")) {
      return result("", {
        limited: false,
        weak: true,
        note: READ_OK_NOTE,
      });
    }

    if (looksMostlyText(bytes)) {
      return result(Buffer.from(bytes).toString("utf8"));
    }

    const binary = extractBinaryText(bytes);
    if (!isWeakText(binary)) return result(binary, { limited: true });
    return result("", { limited: true });
  } catch {
    return result("", { limited: true });
  }
}
