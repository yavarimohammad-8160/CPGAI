import { existsSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import puppeteer from "puppeteer-core";
import { FA_DOC_FONT_FILES, adaptTextForBNazanin } from "@/lib/doc-font";

function findChrome(): string {
  const fromEnv = (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) {
    if (existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  throw new Error(
    "مرورگر Chrome/Edge برای ساخت PDF پیدا نشد. CHROME_PATH را در .env.local تنظیم کنید."
  );
}

function fontFileUrl(weight: "Regular" | "Bold") {
  const name = weight === "Bold" ? FA_DOC_FONT_FILES.bold : FA_DOC_FONT_FILES.regular;
  const file = path.join(process.cwd(), "public", "fonts", name);
  if (!existsSync(/*turbopackIgnore: true*/ file)) return "";
  const resolved = path.resolve(file).replace(/\\/g, "/");
  const withSlash = resolved.startsWith("/") ? resolved : `/${resolved}`;
  return `file://${encodeURI(withSlash)}`;
}

function escapeHtml(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Drop Private Use / replacement glyphs and normalize Persian letters & digits. */
export function sanitizePdfText(input: string): string {
  let s = String(input || "");
  try {
    s = s.normalize("NFC");
  } catch {
    /* ignore */
  }
  s = s.replace(/\u064A/g, "\u06CC").replace(/\u0643/g, "\u06A9");
  s = s.replace(/[\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  s = s.replace(/\uFFFD/g, "");
  s = s.replace(/[\uE000-\uF8FF]/g, "");
  s = Array.from(s)
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0xF0000 && cp <= 0xFFFFD) return false;
      if (cp >= 0x100000 && cp <= 0x10FFFD) return false;
      return true;
    })
    .join("");
  s = s.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

export function toPersianDigits(input: string): string {
  const map: Record<string, string> = {
    "0": "۰",
    "1": "۱",
    "2": "۲",
    "3": "۳",
    "4": "۴",
    "5": "۵",
    "6": "۶",
    "7": "۷",
    "8": "۸",
    "9": "۹",
    "\u0660": "۰",
    "\u0661": "۱",
    "\u0662": "۲",
    "\u0663": "۳",
    "\u0664": "۴",
    "\u0665": "۵",
    "\u0666": "۶",
    "\u0667": "۷",
    "\u0668": "۸",
    "\u0669": "۹",
  };
  return String(input || "").replace(/[0-9\u0660-\u0669]/g, (d) => map[d] || d);
}

export type PdfBlock =
  | { type: "title" | "h2" | "h3" | "p" | "li"; text: string }
  | { type: "table"; rows: string[][] };

function prep(text: string, persianDigits: boolean) {
  let t = adaptTextForBNazanin(sanitizePdfText(text));
  if (persianDigits) t = toPersianDigits(t);
  return t;
}

export function blocksToPdfHtml(opts: {
  blocks: PdfBlock[];
  title?: string;
  brand?: string;
  footer?: string;
  audience?: "org" | "public";
  persianDigits?: boolean;
}) {
  const persianDigits = opts.persianDigits !== false;
  const regular = fontFileUrl("Regular");
  const bold = fontFileUrl("Bold") || regular;
  const brand = prep(
    opts.brand || (opts.audience === "org" ? "سی‌پی‌جی پارس" : "CPGAI"),
    persianDigits
  );
  const footer = prep(
    opts.footer ||
      (opts.audience === "org"
        ? "سی‌پی‌جی پارس — محرمانه سازمانی"
        : "تهیه‌شده با CPGAI"),
    persianDigits
  );
  const accent = opts.audience === "org" ? "#C9A227" : "#2A9D8F";
  const navy = opts.audience === "org" ? "#0F2744" : "#1B263B";
  const title = prep(opts.title || "", persianDigits);

  const body = opts.blocks
    .map((block) => {
      if (block.type === "table") {
        if (!block.rows.length) return "";
        const head = block.rows[0]
          .map((c) => `<th>${escapeHtml(prep(c, persianDigits))}</th>`)
          .join("");
        const rows = block.rows
          .slice(1)
          .map(
            (r) =>
              `<tr>${r
                .map((c) => `<td>${escapeHtml(prep(c, persianDigits))}</td>`)
                .join("")}</tr>`
          )
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      const text = escapeHtml(prep(block.text, persianDigits));
      if (block.type === "title") return `<h1>${text}</h1>`;
      if (block.type === "h2") return `<h2>${text}</h2>`;
      if (block.type === "h3") return `<h3>${text}</h3>`;
      if (block.type === "li") return `<li>${text}</li>`;
      return `<p>${text}</p>`;
    })
    .join("\n");

  const withLists = body.replace(
    /(?:<li>[\s\S]*?<\/li>\s*)+/g,
    (m) => `<ul>${m}</ul>`
  );

  const fontFace = regular
    ? `@font-face {
  font-family: "B Nazanin";
  src: url('${regular}') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "B Nazanin";
  src: url('${bold}') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: block;
}`
    : "";

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
${fontFace}
* { box-sizing: border-box; }
body {
  font-family: "B Nazanin", Tahoma, "Segoe UI", sans-serif;
  color: #1c2e44;
  font-size: 11.5pt;
  line-height: 1.85;
  margin: 0;
  direction: rtl;
  text-align: right;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "liga" 0, "clig" 0, "calt" 0, "dlig" 0, "rlig" 0;
  font-variant-ligatures: none;
  font-kerning: normal;
}
.header {
  border-bottom: 3px solid ${accent};
  padding-bottom: 10px;
  margin-bottom: 18px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}
.brand {
  color: ${navy};
  font-weight: 700;
  font-size: 12pt;
}
.badge {
  color: ${accent};
  font-size: 9.5pt;
  font-weight: 700;
}
h1 {
  color: ${navy};
  font-size: 16pt;
  margin: 0 0 14px;
  line-height: 1.5;
}
h2 {
  color: ${navy};
  font-size: 13pt;
  margin: 18px 0 8px;
  padding-right: 10px;
  border-right: 4px solid ${accent};
}
h3 {
  color: ${navy};
  font-size: 12pt;
  margin: 14px 0 6px;
}
p { margin: 0 0 10px; }
ul { margin: 0 0 12px; padding-right: 18px; }
li { margin: 0 0 4px; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 16px;
  font-size: 9.5pt;
}
th, td {
  border: 1px solid #d5dde8;
  padding: 8px 7px;
  vertical-align: top;
  text-align: right;
}
th {
  background: ${navy};
  color: #fff;
  font-weight: 700;
}
tbody tr:nth-child(even) td { background: #f4f7fb; }
.footer {
  margin-top: 22px;
  padding-top: 8px;
  border-top: 1px solid #d5dde8;
  color: #5b6b7c;
  font-size: 9pt;
  display: flex;
  justify-content: space-between;
}
</style>
</head>
<body>
  <div class="header">
    <div class="brand">${escapeHtml(brand)}</div>
    <div class="badge">${opts.audience === "org" ? "سند سازمانی" : "سند حرفه‌ای"}</div>
  </div>
  ${title ? `<h1>${escapeHtml(title)}</h1>` : ""}
  ${withLists}
  <div class="footer">
    <span>${escapeHtml(footer)}</span>
    <span>CPGAI</span>
  </div>
</body>
</html>`;
}

export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const executablePath = findChrome();
  const dir = mkdtempSync(path.join(tmpdir(), "cpgai-pdf-"));
  const htmlPath = path.join(dir, "doc.html");
  writeFileSync(htmlPath, html, "utf8");
  const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--disable-font-subpixel-positioning",
      "--allow-file-access-from-files",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(async () => {
      if ((document as any).fonts?.ready) await (document as any).fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 150));
    console.log("PDF_ENGINE chrome", executablePath);
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
