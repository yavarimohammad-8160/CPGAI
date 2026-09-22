import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import puppeteer from "puppeteer-core";
import { FA_DOC_FONT_FILES } from "@/lib/doc-font";
import { chatCompletions, getTextClient, parseCompletion } from "@/lib/llm";
import ExcelJS from "exceljs";
import { injectNativeExcelChart } from "@/lib/excel-native-chart";

export type ChartType = "pie" | "bar" | "line";

export type ChartSpec = {
  type: ChartType;
  title: string;
  labels: string[];
  values: number[];
  unit?: string;
  note?: string;
};

export function isChartAsk(text: string) {
  const t = String(text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .trim();
  if (!t) return false;
  if (/matplotlib|plt\.|import\s+matplotlib/.test(t) && t.length < 80) return false;
  return /نمودار|چارت|گراف|pie\s*chart|bar\s*chart|line\s*chart|ترسیم کن|رسم کن|بکش|میخوای نمودار|میخوام نمودار|نمودار برام|نمودار برایم|نمودار بده|نمودار بساز/i.test(
    t
  );
}

export function looksLikeMatplotlibDump(text: string) {
  return /import\s+matplotlib|plt\.pie|plt\.bar|plt\.plot|plt\.savefig/.test(
    String(text || "")
  );
}

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
  throw new Error("Chrome/Edge برای ساخت نمودار پیدا نشد.");
}

function fontCss() {
  const dir = path.join(process.cwd(), "public", "fonts");
  const regular = path.join(dir, FA_DOC_FONT_FILES.regular);
  const bold = path.join(dir, FA_DOC_FONT_FILES.bold);
  const toData = (file: string) => {
    if (!existsSync(file)) return "";
    const b64 = readFileSync(file).toString("base64");
    return `url(data:font/ttf;base64,${b64})`;
  };
  const r = toData(regular);
  const b = toData(bold);
  return `
    @font-face { font-family: 'B Nazanin'; src: ${r || "local('Tahoma')"}; font-weight: 400; }
    @font-face { font-family: 'B Nazanin'; src: ${b || r || "local('Tahoma')"}; font-weight: 700; }
  `;
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function piePaths(values: number[], cx: number, cy: number, r: number) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const colors = ["#0f2744", "#1d4ed8", "#0d9488", "#ca8a04", "#c2410c", "#7c3aed", "#be185d", "#64748b"];
  const parts: string[] = [];
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += slice;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = slice > Math.PI ? 1 : 0;
    parts.push(
      `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[i % colors.length]}"></path>`
    );
  });
  return parts.join("\n");
}

function buildChartHtml(spec: ChartSpec) {
  const labels = spec.labels || [];
  const values = (spec.values || []).map((n) => Number(n) || 0);
  const n = Math.min(labels.length, values.length);
  const L = labels.slice(0, n);
  const V = values.slice(0, n);
  const total = V.reduce((a, b) => a + b, 0) || 1;
  const colors = ["#0f2744", "#1d4ed8", "#0d9488", "#ca8a04", "#c2410c", "#7c3aed", "#be185d", "#64748b"];
  const legend = L.map((lab, i) => {
    const pct = ((V[i] / total) * 100).toFixed(1);
    return `<div class="leg"><span class="sw" style="background:${colors[i % colors.length]}"></span><span>${escapeHtml(lab)} — ${pct}%</span></div>`;
  }).join("");

  let body = "";
  if (spec.type === "bar" || spec.type === "line") {
    const max = Math.max(...V, 1);
    const w = 640;
    const h = 360;
    const pad = 48;
    const gap = (w - pad * 2) / Math.max(n, 1);
    if (spec.type === "bar") {
      const bars = V.map((v, i) => {
        const bh = ((v / max) * (h - pad * 2));
        const x = pad + i * gap + gap * 0.15;
        const y = h - pad - bh;
        const bw = gap * 0.7;
        return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${colors[i % colors.length]}" rx="6"></rect>
          <text x="${x + bw / 2}" y="${h - pad + 18}" text-anchor="middle" class="tick">${escapeHtml(L[i]).slice(0, 12)}</text>
          <text x="${x + bw / 2}" y="${y - 8}" text-anchor="middle" class="val">${V[i]}</text>`;
      }).join("");
      body = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="360">${bars}</svg>`;
    } else {
      const pts = V.map((v, i) => {
        const x = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
        const y = h - pad - (v / max) * (h - pad * 2);
        return `${x},${y}`;
      }).join(" ");
      const dots = V.map((v, i) => {
        const x = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
        const y = h - pad - (v / max) * (h - pad * 2);
        return `<circle cx="${x}" cy="${y}" r="5" fill="#1d4ed8"></circle>
          <text x="${x}" y="${h - pad + 18}" text-anchor="middle" class="tick">${escapeHtml(L[i]).slice(0, 10)}</text>`;
      }).join("");
      body = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="360"><polyline fill="none" stroke="#1d4ed8" stroke-width="3" points="${pts}"></polyline>${dots}</svg>`;
    }
  } else {
    body = `<div class="pie-wrap"><svg viewBox="0 0 320 320" width="320" height="320">${piePaths(V, 160, 160, 140)}</svg><div class="legend">${legend}</div></div>`;
  }

  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
  <style>
    ${fontCss()}
    body{margin:0;background:#f8fafc;font-family:'B Nazanin',Tahoma,sans-serif;color:#0f172a}
    .card{width:900px;padding:28px 32px;box-sizing:border-box}
    h1{margin:0 0 8px;font-size:26px;font-weight:700}
    .sub{margin:0 0 18px;color:#475569;font-size:14px}
    .pie-wrap{display:flex;gap:28px;align-items:center;justify-content:center}
    .legend{display:flex;flex-direction:column;gap:10px;font-size:15px}
    .leg{display:flex;gap:10px;align-items:center}
    .sw{width:14px;height:14px;border-radius:4px;display:inline-block}
    .tick{font-size:11px;fill:#334155}
    .val{font-size:12px;fill:#0f172a;font-weight:700}
    .foot{margin-top:16px;color:#64748b;font-size:12px}
  </style></head><body><div class="card">
    <h1>${escapeHtml(spec.title || "نمودار")}</h1>
    <p class="sub">${escapeHtml(spec.note || "")}</p>
    ${body}
    <p class="foot">CPGAI · نمودار ساخته‌شده از داده‌های گفتگو</p>
  </div></body></html>`;
}

export async function renderChartPng(spec: ChartSpec): Promise<Buffer> {
  const html = buildChartHtml(spec);
  const dir = mkdtempSync(path.join(tmpdir(), "cpgai-chart-"));
  const htmlPath = path.join(dir, "chart.html");
  writeFileSync(htmlPath, html, "utf8");
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 2 });
    await page.goto("file://" + htmlPath.replace(/\\/g, "/"), { waitUntil: "load", timeout: 30000 });
    const el = await page.$(".card");
    const buf = el
      ? ((await el.screenshot({ type: "png" })) as Buffer)
      : ((await page.screenshot({ type: "png" })) as Buffer);
    return Buffer.from(buf);
  } finally {
    await browser.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function parseSpecJson(raw: string): ChartSpec | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<ChartSpec>;
    const type = j.type === "bar" || j.type === "line" || j.type === "pie" ? j.type : "pie";
    const labels = Array.isArray(j.labels) ? j.labels.map((x) => String(x)) : [];
    const values = Array.isArray(j.values) ? j.values.map((x) => Number(x) || 0) : [];
    if (labels.length < 2 || values.length < 2) return null;
    return {
      type,
      title: String(j.title || "نمودار"),
      labels,
      values,
      unit: j.unit ? String(j.unit) : "",
      note: j.note ? String(j.note) : "",
    };
  } catch {
    return null;
  }
}

export async function buildChartSpecFromChat(
  ask: string,
  context: string
): Promise<ChartSpec | null> {
  const client = getTextClient();
  if (!client) return null;
  const data = await chatCompletions(
    client,
    {
      messages: [
        {
          role: "system",
          content:
            "Extract a chart specification as JSON only. Keys: type (pie|bar|line), title, labels (string[]), values (number[]), note (optional Persian caption). Use numbers from the context. If percentages, keep them as numbers. No markdown, no code, no matplotlib.",
        },
        {
          role: "user",
          content: "درخواست کاربر:\n" + ask + "\n\nمتن/داده زمینه:\n" + context.slice(0, 12000),
        },
      ],
      temperature: 0,
      max_tokens: 800,
    },
    { timeoutMs: 45000 }
  );
  return parseSpecJson(parseCompletion(data).text);
}

export function isChartExcelAsk(text: string) {
  const t = String(text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .trim();
  if (!t) return false;
  if (!/اکسل|excel|xlsx/i.test(t)) return false;
  return (
    isChartAsk(t) ||
    /نمودار|چارت|گراف|همین عکس|همین تصویر|همین نمودار|عکس نمودار|تصویر نمودار|قابل ویرایش/i.test(
      t
    )
  );
}

function safeSheetName(name: string) {
  return (
    String(name || "داده")
      .replace(/[\\/?*\[\]:]/g, " ")
      .trim()
      .slice(0, 28) || "داده"
  );
}

export async function buildChartExcel(spec: ChartSpec): Promise<{
  fileName: string;
  fileBase64: string;
  fileMime: string;
}> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CPGAI";
  workbook.created = new Date();

  const labels = spec.labels || [];
  const values = (spec.values || []).map((n) => Number(n) || 0);
  const n = Math.min(labels.length, values.length);
  const L = labels.slice(0, n);
  const V = values.slice(0, n);
  const total = V.reduce((a, b) => a + b, 0);

  const dataSheetName = safeSheetName("داده نمودار");
  const data = workbook.addWorksheet(dataSheetName);
  data.views = [{ rightToLeft: true }];

  let rowIdx = 1;
  data.mergeCells(rowIdx, 1, rowIdx, 4);
  data.getCell(rowIdx, 1).value = spec.title || "نمودار";
  data.getCell(rowIdx, 1).font = {
    name: "B Nazanin",
    bold: true,
    size: 14,
    color: { argb: "FF0F2744" },
  };
  data.getCell(rowIdx, 1).alignment = { horizontal: "right", vertical: "middle" };
  rowIdx += 1;

  if (spec.note) {
    data.mergeCells(rowIdx, 1, rowIdx, 4);
    data.getCell(rowIdx, 1).value = spec.note;
    data.getCell(rowIdx, 1).font = {
      name: "B Nazanin",
      size: 10,
      color: { argb: "FF475569" },
    };
    data.getCell(rowIdx, 1).alignment = { horizontal: "right" };
    rowIdx += 1;
  }

  rowIdx += 1; // blank
  const headerRow = rowIdx;
  const headers = ["ردیف", "عنوان", "مقدار", "درصد"];
  headers.forEach((h, i) => {
    const cell = data.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: "B Nazanin", bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F2744" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  data.getColumn(1).width = 8;
  data.getColumn(2).width = 28;
  data.getColumn(3).width = 14;
  data.getColumn(4).width = 12;

  for (let i = 0; i < n; i += 1) {
    const r = headerRow + 1 + i;
    data.getCell(r, 1).value = i + 1;
    data.getCell(r, 2).value = L[i];
    data.getCell(r, 3).value = V[i];
    data.getCell(r, 4).value = total ? Number(((V[i] / total) * 100).toFixed(2)) : 0;
    for (let c = 1; c <= 4; c += 1) {
      data.getCell(r, c).font = { name: "B Nazanin", size: 11 };
      data.getCell(r, c).alignment = { horizontal: "right", vertical: "middle" };
    }
    data.getCell(r, 3).numFmt = "0.####";
    data.getCell(r, 4).numFmt = "0.00";
  }

  const sumRow = headerRow + 1 + n;
  data.getCell(sumRow, 2).value = "جمع";
  data.getCell(sumRow, 3).value = total;
  data.getCell(sumRow, 4).value = total ? 100 : 0;
  data.getCell(sumRow, 2).font = { name: "B Nazanin", bold: true, size: 11 };
  data.getCell(sumRow, 3).font = { name: "B Nazanin", bold: true, size: 11 };
  data.getCell(sumRow, 3).numFmt = "0.####";

  const visual = workbook.addWorksheet(safeSheetName("پیش‌نمایش"));
  visual.views = [{ rightToLeft: true }];
  visual.mergeCells("A1:F1");
  visual.getCell("A1").value =
    "پیش‌نمایش تصویر. برگه «داده نمودار» هم جدول قابل ویرایش دارد و هم نمودار بومی اکسل (با تغییر عددها نمودار به‌روز می‌شود).";
  visual.getCell("A1").font = { name: "B Nazanin", size: 11, color: { argb: "FF334155" } };

  try {
    const png = await renderChartPng(spec);
    const imgId = workbook.addImage({
      buffer: png as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    visual.addImage(imgId, {
      tl: { col: 0, row: 2 },
      ext: { width: 720, height: 480 },
    });
  } catch {
    visual.getCell("A3").value =
      "پیش‌نمایش تصویری ساخته نشد؛ داده و نمودار بومی در برگه اول هستند.";
    visual.getCell("A3").font = { name: "B Nazanin", size: 11 };
  }

  let buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  if (n > 0) {
    try {
      buffer = await injectNativeExcelChart(buffer, {
        type: spec.type === "pie" || spec.type === "line" ? spec.type : "bar",
        title: spec.title || "نمودار",
        sheetName: dataSheetName,
        firstDataRow: headerRow + 1,
        lastDataRow: headerRow + n,
        catCol: "B",
        valCol: "C",
        seriesTitleCell: "C" + headerRow,
      });
    } catch {
      // keep data+preview workbook if chart injection fails
    }
  }

  const base = String(spec.title || "نمودار")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return {
    fileName: (base || "chart") + ".xlsx",
    fileBase64: buffer.toString("base64"),
    fileMime:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
