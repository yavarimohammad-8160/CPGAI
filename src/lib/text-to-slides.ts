export type SlideCard = {
  title: string;
  bullets: string[];
  imagePath?: string;
};

export type SlidePlan = {
  title: string;
  subtitle: string;
  slides: SlideCard[];
};

const JUNK =
  /فایل خوانده شد|نام فایل:|دستور کاربر|گزارش عملکرد|قوی و خوشگل|خوشگل|SAMPLE|ممنوع است|از این فایل بساز|ارائه مدیریتی سالانه|متن استخراج|لاگ سیستم|من CPGAI هستم|دستیار هوشمند|در خدمت شما هستم|نگاه راهبردی شما|اطلاعات دقیقی ارائه دادید/i;

const QUALITY =
  /قوی|خوشگل|زیبا|شیک|حرفه‌ای|حرفه ای|عالی|کامل|دقیق|مدون|جذاب/;

export function isJunkSlideTitle(title: string) {
  const t = String(title || "").trim();
  if (!t) return true;
  if (JUNK.test(t)) return true;
  if (QUALITY.test(t) && t.length < 28) return true;
  return false;
}

export function userAskOnly(text: string) {
  return String(text || "")
    .split(
      /\n(?:نام فایل:|محتوای فایل:|فایل خوانده شد|متن تصویر خوانده شد|متن استخراج‌شده از تصویر:|محتوای اصلی برای تبدیل به پاورپوینت)/
    )[0]
    .trim();
}

export function sourceTextOnly(text: string) {
  const raw = String(text || "").replace(/\r/g, "");
  const chunks = raw.split(
    /محتوای فایل:|متن از صفحات اسکن‌شده:|متن استخراج‌شده از تصویر:|متن فایل Word قبلی:|محتوای اصلی برای تبدیل به پاورپوینت[^\n]*\n?/
  );
  if (chunks.length < 2) return "";
  return chunks
    .slice(1)
    .join("\n")
    .replace(/^فایل خوانده شد\.?\s*/gm, "")
    .replace(/^نام فایل:.*$/gm, "")
    .replace(/^دستور کاربر:[\s\S]*/m, "")
    .replace(/گزارش عملکرد(?: سالانه)? ممنوع است\.?/g, "")
    .replace(/نمونه عملکرد سالانه ممنوع است\.?/g, "")
    .replace(/SAMPLE نساز\.?/gi, "")
    .replace(/قوی|خوشگل|زیبا|شیک|حرفه‌ای|عالی|کامل|دقیق|مدون|جذاب/g, " ")
    .replace(/^فقط از محتوای اصلی[\s\S]*$/m, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseSlidePlan(raw: string): SlidePlan | null {
  const text = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      title?: unknown;
      subtitle?: unknown;
      slides?: unknown;
    };
    if (!obj || !Array.isArray(obj.slides)) return null;
    const slides: SlideCard[] = [];
    for (const row of obj.slides) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const title = clean(item.title).slice(0, 80);
      const values = Array.isArray(item.bullets)
        ? item.bullets
        : Array.isArray(item.body)
          ? item.body
          : [];
      const bullets = values
        .map(clean)
        .filter(Boolean)
        .filter((b) => !JUNK.test(b))
        .slice(0, 5);
      if (!title || isJunkSlideTitle(title) || bullets.length < 2) continue;
      slides.push({ title, bullets });
    }
    const title = clean(obj.title) || slides[0]?.title || "";
    if (!title || isJunkSlideTitle(title) || slides.length < 6 || slides.length > 12) {
      return null;
    }
    return {
      title: title.slice(0, 80),
      subtitle: clean(obj.subtitle).slice(0, 90),
      slides,
    };
  } catch {
    return null;
  }
}

function cleanLine(line: string) {
  return String(line || "")
    .replace(/^#+\s*/, "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[\.\-\)]\s*/, "")
    .trim();
}

export function fallbackPlanFromSource(sourceText: string): SlidePlan {
  const source = String(sourceText || "").replace(/\r/g, "").trim();
  const chunks = source.split(/(?=^#{1,3}\s+)/m).map((p) => p.trim()).filter(Boolean);
  const sections =
    chunks.length >= 2
      ? chunks
      : source.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 12);
  const slides: SlideCard[] = [];
  for (const section of sections) {
    if (slides.length >= 12) break;
    const lines = section
      .split("\n")
      .map(cleanLine)
      .filter((line) => line.length > 2 && !JUNK.test(line) && !isJunkSlideTitle(line));
    if (!lines.length) continue;
    const title = lines[0].slice(0, 80);
    const bullets = lines
      .slice(1)
      .filter((line) => line.length > 8)
      .slice(0, 5);
    if (bullets.length < 1) continue;
    slides.push({
      title,
      bullets: bullets.length >= 2 ? bullets : [lines[1] || title, ...bullets].slice(0, 5),
    });
  }
  const title = slides[0]?.title || "ارائه";
  const subtitle = slides[1]?.title || "";
  return { title, subtitle, slides: slides.slice(0, 12) };
}
