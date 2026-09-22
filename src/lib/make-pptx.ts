import { existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";
import type { SlidePlan } from "@/lib/text-to-slides";
import { audienceChrome, type DocAudience } from "@/lib/file-style";
import { FA_DOC_FONT } from "@/lib/doc-font";

function clip(text: string, max: number) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + "…";
}

type SlideLike = {
  addShape: Function;
  addText: Function;
  addImage?: Function;
  background?: { color: string };
};

function addFooter(
  s: SlideLike,
  chrome: ReturnType<typeof audienceChrome>,
  page: number,
  total: number,
  rtl: boolean
) {
  s.addShape("rect", {
    x: 0,
    y: 7.12,
    w: 13.333,
    h: 0.38,
    fill: { color: chrome.wash },
  });
  s.addShape("rect", {
    x: 0,
    y: 7.12,
    w: 13.333,
    h: 0.035,
    fill: { color: chrome.accent },
  });
  s.addText(chrome.footer, {
    x: rtl ? 2.8 : 0.55,
    y: 7.16,
    w: 9.8,
    h: 0.28,
    fontFace: FA_DOC_FONT,
    fontSize: 10,
    color: chrome.ink,
    align: rtl ? "right" : "left",
    valign: "middle",
  });
  s.addText(String(page) + " / " + String(total), {
    x: rtl ? 0.4 : 11.7,
    y: 7.16,
    w: 1.2,
    h: 0.28,
    fontFace: FA_DOC_FONT,
    fontSize: 10,
    color: chrome.ink,
    align: rtl ? "left" : "right",
    valign: "middle",
  });
}

function addAccentRail(s: SlideLike, chrome: ReturnType<typeof audienceChrome>, rtl: boolean) {
  s.addShape("rect", {
    x: rtl ? 12.95 : 0,
    y: 0,
    w: 0.38,
    h: 7.5,
    fill: { color: chrome.accent },
  });
}

export async function makeProfessionalPptx(opts: {
  title: string;
  subtitle?: string;
  slides: SlidePlan["slides"];
  fileBaseName: string;
  topic?: string;
  rtl?: boolean;
  audience?: DocAudience;
}) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.author = "CPGAI";
  pptx.title = opts.title;
  pptx.subject = opts.topic || opts.title;
  const rtl = opts.rtl !== false;
  const align = rtl ? "right" : "left";
  const audience: DocAudience = opts.audience || "public";
  const chrome = audienceChrome(audience, !rtl);
  const contentSlides = Array.isArray(opts.slides) ? opts.slides : [];
  const hasClosing = audience === "org" || contentSlides.length >= 3;
  const total = 1 + Math.max(1, contentSlides.length) + (hasClosing ? 1 : 0);

  // —— Cover ——
  {
    const s = pptx.addSlide() as unknown as SlideLike;
    s.background = { color: chrome.navy };
    addAccentRail(s, chrome, rtl);
    // Soft wash panel
    s.addShape("rect", {
      x: rtl ? 0.6 : 7.2,
      y: 0,
      w: 5.5,
      h: 7.5,
      fill: { color: "0A1C33" },
    });
    s.addText(chrome.brand, {
      x: 0.95,
      y: 1.05,
      w: 11.2,
      h: 0.4,
      fontFace: FA_DOC_FONT,
      fontSize: 14,
      color: chrome.accent,
      align,
      bold: true,
    });
    s.addText(
      audience === "org" ? (rtl ? "سند سازمانی" : "Organizational deck") : chrome.subtitle,
      {
        x: 0.95,
        y: 1.45,
        w: 11.2,
        h: 0.35,
        fontFace: FA_DOC_FONT,
        fontSize: 12,
        color: "A8C0D8",
        align,
      }
    );
    s.addText(clip(opts.title, 80), {
      x: 0.95,
      y: 2.2,
      w: 11.2,
      h: 1.8,
      fontFace: FA_DOC_FONT,
      fontSize: 32,
      bold: true,
      color: "FFFFFF",
      align,
      valign: "middle",
    });
    const sub = opts.subtitle || "";
    if (sub) {
      s.addText(clip(sub, 100), {
        x: 0.95,
        y: 4.15,
        w: 11.2,
        h: 0.6,
        fontFace: FA_DOC_FONT,
        fontSize: 16,
        color: "D6E4F0",
        align,
      });
    }
    s.addShape("rect", {
      x: rtl ? 8.3 : 0.95,
      y: 5.0,
      w: 4.0,
      h: 0.07,
      fill: { color: chrome.accent },
    });
    s.addText("CPGAI", {
      x: 0.95,
      y: 5.3,
      w: 11.2,
      h: 0.35,
      fontFace: FA_DOC_FONT,
      fontSize: 12,
      color: "8FA6BC",
      align,
    });
    addFooter(s, chrome, 1, total, rtl);
  }

  let page = 2;
  contentSlides.forEach((card, idx) => {
    const s = pptx.addSlide() as unknown as SlideLike;
    s.background = { color: "FFFFFF" };
    addAccentRail(s, chrome, rtl);

    // Top band
    s.addShape("rect", {
      x: 0,
      y: 0,
      w: 13.333,
      h: 1.08,
      fill: { color: chrome.navy },
    });
    s.addShape("rect", {
      x: 0,
      y: 1.08,
      w: 13.333,
      h: 0.07,
      fill: { color: chrome.accent },
    });
    s.addText(clip(card.title || "اسلاید " + String(idx + 1), 70), {
      x: 0.75,
      y: 0.28,
      w: 11.6,
      h: 0.55,
      fontFace: FA_DOC_FONT,
      fontSize: 22,
      bold: true,
      color: "FFFFFF",
      align,
      valign: "middle",
    });

    const hasImage = !!(card.imagePath && existsSync(card.imagePath));
    const textX = hasImage ? (rtl ? 5.55 : 0.7) : 0.7;
    const textW = hasImage ? 7.0 : 11.8;

    s.addShape("roundRect", {
      x: textX,
      y: 1.4,
      w: textW,
      h: 5.45,
      fill: { color: chrome.wash },
      shadow: {
        type: "outer",
        color: "000000",
        blur: 10,
        offset: 2,
        opacity: 0.07,
      },
    });

    // Accent tick on card
    s.addShape("rect", {
      x: rtl ? textX + textW - 0.12 : textX,
      y: 1.4,
      w: 0.12,
      h: 5.45,
      fill: { color: chrome.accent },
    });

    const bullets = (card.bullets || [])
      .map((b) => clip(String(b || ""), 130))
      .filter(Boolean)
      .slice(0, 6);

    if (bullets.length) {
      s.addText(
        bullets.map((b) => ({
          text: b,
          options: { bullet: true, breakLine: true },
        })),
        {
          x: textX + 0.4,
          y: 1.65,
          w: textW - 0.7,
          h: 5.0,
          fontFace: FA_DOC_FONT,
          fontSize: hasImage ? 15 : 17,
          color: chrome.ink,
          align,
          valign: "top",
          paraSpaceAfter: 14,
        }
      );
    }

    if (hasImage && s.addImage) {
      try {
        s.addImage({
          path: card.imagePath as string,
          x: rtl ? 0.45 : 8.0,
          y: 1.45,
          w: 4.85,
          h: 5.35,
        });
      } catch {
        /* keep text-only */
      }
    }

    addFooter(s, chrome, page, total, rtl);
    page += 1;
  });

  if (hasClosing) {
    const s = pptx.addSlide() as unknown as SlideLike;
    s.background = { color: chrome.navy };
    addAccentRail(s, chrome, rtl);
    s.addText(chrome.brand, {
      x: 0.95,
      y: 2.2,
      w: 11.4,
      h: 0.4,
      fontFace: FA_DOC_FONT,
      fontSize: 14,
      color: chrome.accent,
      align,
      bold: true,
    });
    s.addText(
      rtl ? "با سپاس از توجه شما" : "Thank you",
      {
        x: 0.95,
        y: 2.9,
        w: 11.4,
        h: 0.9,
        fontFace: FA_DOC_FONT,
        fontSize: 34,
        bold: true,
        color: "FFFFFF",
        align,
      }
    );
    s.addText(
      rtl
        ? "آماده‌ی ادامه گفتگو و اقدام‌های بعدی هستیم."
        : "Ready for next steps and discussion.",
      {
        x: 0.95,
        y: 4.0,
        w: 11.4,
        h: 0.5,
        fontFace: FA_DOC_FONT,
        fontSize: 16,
        color: "D6E4F0",
        align,
      }
    );
    s.addShape("rect", {
      x: rtl ? 8.5 : 0.95,
      y: 4.7,
      w: 3.8,
      h: 0.06,
      fill: { color: chrome.accent },
    });
    addFooter(s, chrome, page, total, rtl);
  }

  const fileName = opts.fileBaseName.endsWith(".pptx")
    ? opts.fileBaseName
    : opts.fileBaseName + ".pptx";
  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return {
    fileName,
    fileBase64: Buffer.from(buffer).toString("base64"),
    fileMime:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}
