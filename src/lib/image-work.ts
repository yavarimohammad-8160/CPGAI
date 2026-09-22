export function askOnly(text: string) {
  return (text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .split("متن تصویر")[0]
    .trim();
}

function isDocOutputAsk(text: string) {
  return /شناسنامه شغلی|شرح شغل|خروجی ورد|فایل ورد|خروجی pdf|پاورپوینت|اکسل|متن ارائه|اصلاح کن|دوباره بفرست|مجدداً?\s*بفرست|دانلود کنم|فایل اصلاح|ارائه\s*(بده|بساز|کن)|اسلاید/.test(
    text
  );
}

export function looksLikeWrittenImagePrompt(text: string) {
  const t = text || "";
  if (t.length < 60) return false;
  const hits = [
    /پرامپت/i,
    /\bprompt\b/i,
    /پس‌زمینه|پس زمینه/,
    /ترکیب رنگ|رنگ‌های اصلی|رنگ اصلی/,
    /سبک بصری|سبک:/,
    /ابعاد|قطع\s*A4|\bA4\b/,
    /عنوان:/,
    /لوگو/,
    /طرح جلد|صفحه اول/,
    /نورپردازی|کامپوزیشن|composition/i,
    /\*\*[^*]+:\*\*/,
    /^##\s/m,
  ].filter((re) => re.test(t)).length;
  return hits >= 2;
}

export function lastAssistantWroteImagePrompt(
  messages?: { role?: string; content?: string; image?: string }[]
) {
  if (!messages?.length) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.image) return false;
    return looksLikeWrittenImagePrompt(msg.content || "");
  }
  return false;
}

function isFreshGenerateAsk(text: string) {
  return /یه عکس|یک عکس|عکس بده|تصویر بده|تصویر بساز|عکس بساز|عکس را بساز|عکس بفرست|عکس را بفرست|تصویر بفرست|بکش|طراحی کن|عکس از|تصویری از|چند عکس|چند تصویر|[0-9۰-۹٠-٩]+\s*(?:تا\s*)?(?:عکس|تصویر)|جدا جدا|بساز و بفرست/.test(
    text
  );
}

export function isRealImageSrc(src?: string) {
  const s = String(src || "").trim();
  if (!s) return false;
  if (s.startsWith("data:image")) return true;
  if (s.startsWith("blob:")) return true;
  if (s.startsWith("/api/media/")) return true;
  if (s.startsWith("/generated") || s.startsWith("/outputs")) return true;
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  return false;
}

export function collectMessageImages(msg?: {
  image?: string;
  images?: string[];
}) {
  const out: string[] = [];
  const add = (src?: string) => {
    const s = String(src || "").trim();
    if (!isRealImageSrc(s) || out.includes(s)) return;
    out.push(s);
  };
  add(msg?.image);
  if (Array.isArray(msg?.images)) {
    for (const item of msg.images) add(item);
  }
  return out;
}

export function requestedImageCount(text: string) {
  const t = askOnly(text);
  const map: Record<string, number> = {
    یک: 1,
    یه: 1,
    دو: 2,
    سه: 3,
    چهار: 4,
    پنج: 5,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "۱": 1,
    "۲": 2,
    "۳": 3,
    "۴": 4,
    "۵": 5,
    "١": 1,
    "٢": 2,
    "٣": 3,
    "٤": 4,
    "٥": 5,
  };
  const m = t.match(
    /([0-9۰-۹٠-٩]+|یک|یه|دو|سه|چهار|پنج)\s*(?:تا\s*)?(?:عکس|تصویر)/
  );
  if (m) {
    const n = map[m[1]] || parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(5, n);
  }
  if (/چند عکس|چند تصویر|جدا جدا|هر کدام جدا|جداگانه/.test(t)) return 3;
  return 1;
}

export function wantsLogoOnImage(text: string) {
  return /لوگو|آرم/.test(askOnly(text));
}

export function shouldStampLogo(
  text: string,
  messages?: { role?: string; content?: string }[]
) {
  if (wantsLogoOnImage(text)) return true;
  if (!isBareImageCommand(text) && !isImageConfirmAsk(text)) return false;
  return (messages || []).some(
    (msg) => msg.role === "user" && wantsLogoOnImage(msg.content || "")
  );
}

export function isImageConfirmAsk(text: string) {
  const t = askOnly(text)
    .replace(/[?.!؟،,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 48) return false;
  if (isDocOutputAsk(t)) return false;
  if (/عکس از|تصویر از|چند عکس|تا عکس|طراحی کن|بکش|پوستر|بنر/.test(t)) {
    return false;
  }
  return /^(باشه|منتظرم|ادامه بده|بساز|خب بفرست|خب|اوکی|ok|okay|آره|بله|انجام بده|شروع کن|بفرست)(?: (?:باشه|منتظرم|ادامه بده|بساز|بفرست|خب))*$/i.test(
    t
  );
}

export function resumeImageCount(text: string) {
  const n = requestedImageCount(text);
  if (/^(یه|یک)\s*عکس/.test(askOnly(text)) && n === 1) return 1;
  if (n > 1) return n;
  return 5;
}

export function findResumeImageAsk(
  messages?: {
    role?: string;
    content?: string;
    image?: string;
    images?: string[];
  }[]
) {
  if (!messages?.length) return "";
  const last = messages[messages.length - 1];
  if (!isImageConfirmAsk(last?.content || "")) return "";

  const recentUser: string[] = [];
  for (let i = messages.length - 2; i >= 0 && recentUser.length < 4; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const t = askOnly(messages[i].content || "");
    if (t) recentUser.push(t);
  }
  const windowTexts = messages
    .slice(-4, -1)
    .map((msg) => askOnly(msg.content || ""))
    .filter(Boolean);
  const candidates = [...windowTexts, ...recentUser];
  let found = "";
  for (const text of candidates) {
    if (
      isImageGenerateAsk(text) ||
      /[0-9۰-۹٠-٩]+\s*تا\s*(?:عکس|تصویر)|چند عکس|جدا جدا|با این لوگو|عکس بساز/.test(
        text
      )
    ) {
      found = text;
      break;
    }
  }
  if (!found) return "";
  const lastAssistant = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant");
  if (collectMessageImages(lastAssistant).length >= resumeImageCount(found)) {
    return "";
  }
  return found;
}

function refersToExistingImage(text: string) {
  return /ویرایش|همین عکس را تغییر|همین عکس را عوض|این عکس را تغییر بده|این عکس را عوض کن|لوگوی این عکس را عوض|پس‌زمینه|پس زمینه|بک.?گراند|بکگراند|background|همین عکس|این عکس|عکس رو ببین|عکس را ببین|تصویر رو ببین|تصویر را ببین|داخل عکس|داخل تصویر|روی عکس|روی تصویر|قسمت بالا|سمت چپ|سمت راست|خط دوم|نوشته رو حذف|متن رو حذف|این نوشته|این متن/.test(
    text
  );
}

/** Surgical change verbs that imply edit when an image is attached. */
export function isSurgicalImageChange(text: string) {
  const t = askOnly(text);
  if (!t) return false;
  return /حذف کن|پاک کن|عوض کن|تغییر بده|تغییر بده|اصلاح کن|درستش کن|درست کن|بکن |رو بکن|را بکن|هنوز .{0,20}هست|نشد|لباس|بک\s*گراند|بکگراند|تنش کن|استفاده کن|پرچم|فونت|B\s*Nazanin|بی\s*نازنین|نازنین|RTL|راست[-\s]*چین|ابری|رنگ|فقط همین|هیچ تغییر دیگه|هیچ تغییر دیگری|میپتا|میتا|خط\s*(?:اول|دوم|سوم)|نوشته|متن/.test(
    t
  );
}

export function isImageGenerateAsk(text: string) {
  const t = askOnly(text);
  if (!t || isDocOutputAsk(t)) return false;
  if (isFreshGenerateAsk(t)) return true;
  return /تصویرساز|طرح بزن|طرح بده|یه طرح|یک طرح|طرح جلد|پوستر|بنر|کاور|از اون بساز|از روی اون|صفحه اول.{0,20}طرح|طرح.{0,20}صفحه اول|همین پرامپت|این پرامپت|پرامپت.{0,24}(?:بساز|اجرا)|(?:بساز|اجرا).{0,12}پرامپت|همین (?:را|رو) (?:بساز|درست کن)|همین طرح|فقط (?:عکس|تصویر)|بدون (?:توضیح|حرف)|رندر کن|عکس با (?:این )?مشخصات|تصویر با (?:این )?مشخصات/.test(
    t
  ) || (/طرح/.test(t) && /جلد|گرافیک|صنعتی|لوگو|رنگ/.test(t));
}

export function isImageEditAsk(text: string, hasAttachedImage = false) {
  const t = askOnly(text);
  if (!t || isDocOutputAsk(t)) return false;
  // Meta complaint / capability question — answer in chat, do not re-edit.
  if (/چطور الان|چرا (?:نمی|نمى)|مگر نمی|تو که .{0,40}(?:انجام دادی|ویرایش کردی)|چگونه نمی|دسترسی نداری/.test(t) && !/حذف کن|پاک کن|عوض کن|فونت/.test(t)) {
    return false;
  }
  // Reading OCR from image for a document is not an image edit.
  if (/از روی این سند|متن را بخوان|متن تصویر را استخراج|OCR/i.test(t) && !isSurgicalImageChange(t)) {
    return false;
  }
  if (/پرامپت|همین (?:را|رو) بساز|همین طرح/.test(t) && !/ویرایش|حذف|عوض|تغییر/.test(t)) {
    return false;
  }
  if (isImageGenerateAsk(t) && !hasAttachedImage) return false;
  if (isImageGenerateAsk(t) && hasAttachedImage && isSurgicalImageChange(t)) {
    // Prefer edit when user attached a photo and asked for a surgical change.
    return true;
  }
  if (isImageGenerateAsk(t)) return false;
  if (refersToExistingImage(t)) return true;
  if (hasAttachedImage && (isSurgicalImageChange(t) || isEditRetryAsk(t) || !!parseTextSwapAsk(t) || isCompositeImageAsk(t) || isShowImageAgainAsk(t))) {
    return true;
  }
  if (hasAttachedImage && isCompositeImageAsk(t)) return true;
  return false;
}

export function isIndustrialImageTopic(text: string) {
  return /چادرملو|فولاد|معدن|گندله|کنسانتره|مهندسی معکوس|آهن اسفنجی|ناوگان|خوراک|صنایع معدنی|سنگ‌آهن|سنگ آهن|کارخانه|سی‌پی‌جی|cpg\s*pars/i.test(
    askOnly(text)
  );
}

export function isBareImageCommand(text: string) {
  const t = askOnly(text);
  const stripped = t
    .replace(/[0-9۰-۹٠-٩]+\s*(?:تا\s*)?(?:عکس|تصویر)/g, " ")
    .replace(
      /یه عکس|یک عکس|عکس بده|تصویر بده|تصویر بساز|عکس بساز|عکس را بساز|عکس بفرست|عکس را بفرست|تصویر بفرست|چند عکس|چند تصویر|جدا جدا|بساز و بفرست|الان|لطفاً|لطفا/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length < 8;
}

export type TextSwap = { from: string; to: string };

/** Parse Persian swap asks like: میتا رو بکن مپتا / میتا را به مپتا تغییر بده */
export function parseTextSwapAsk(text: string): TextSwap | null {
  const t = askOnly(text);
  if (!t) return null;

  const quoted = [...t.matchAll(/[«""]([^«»""]{2,40})[»""]/g)].map((x) => x[1].trim());
  if (quoted.length >= 2) {
    const from = quoted[0];
    const to = quoted[quoted.length - 1];
    if (from && to && from !== to) return { from, to };
  }

  const patterns: RegExp[] = [
    /(?:کلمه\s*(?:ی|ي)?\s*)?[«""]?([^\s«»""]{2,20})[»""]?\s*(?:رو|را)\s*(?:بکن|بکنی|کن)\s*[«""]?([^\s«»""]{2,20})[»""]?/,
    /[«""]?([^\s«»""]{2,20})[»""]?\s*(?:را|رو)\s*به\s*[«""]?([^\s«»""]{2,20})[»""]?(?:\s*(?:تغییر|عوض|اصلاح))?/,
    /داخل\s*پرانتز\s*[«""]?([^\s«»""]{2,20})[»""]?\s*(?:رو|را)?\s*(?:بکن|کن)\s*[«""]?([^\s«»""]{2,20})[»""]?/,
    /بکن\s*[«""]([^\s«»""]{2,20})[»""]\s*$/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    if (m.length === 2 && /بکن/.test(re.source)) {
      // lone "بکن "to"" — need from from earlier quoted or میتا-like
      const fromHit = t.match(/هنوز\s+[«""]?([^\s«»""]{2,20})[»""]?\s*هست/);
      const from = fromHit?.[1]?.trim();
      const to = String(m[1] || "").trim();
      if (from && to && from !== to) return { from, to };
      continue;
    }
    const from = String(m[1] || "").trim();
    const to = String(m[2] || "").trim();
    if (from.length >= 2 && to.length >= 2 && from !== to) return { from, to };
  }

  // Fallback: هنوز X هست ... بکن Y
  const retry = t.match(
    /هنوز\s+[«""]?([^\s«»""]{2,20})[»""]?\s*هست[\s\S]{0,120}?بکن\s*[«""]?([^\s«»""]{2,20})[»""]?/
  );
  if (retry) {
    const from = retry[1].trim();
    const to = retry[2].trim();
    if (from.length >= 2 && to.length >= 2 && from !== to) return { from, to };
  }
  return null;
}

export function isEditRetryAsk(text: string) {
  const t = askOnly(text).trim();
  if (!t) return false;
  if (/^نشد[!؟.?]*$/u.test(t)) return true;
  if (isShowImageAgainAsk(t)) return true;
  return /نشد|هنوز .{0,40}هست|درست نشد|باز هم|دوباره .{0,30}(?:حذف|عوض|بکن)|همون رو بدون تغییر|بدون تغییر دیگه|مجددا|تصویر نهایی|عکس کو/.test(
    t
  );
}

export function collectEditPrompt(lastText: string) {
  const swap = parseTextSwapAsk(lastText);
  const lines = [
    "You are editing an EXISTING image. Do not create a brand-new unrelated picture.",
    "Keep the same composition, aspect ratio, layout, colors, photos, icons, logo, and all text that the user did not mention.",
    "Do NOT change fonts, font family, weight, size, or text color unless the user explicitly asked to change the font.",
    "Apply ONLY the change the user asked for.",
    "Do not add steel, mining, factories, or CPG branding unless the user asked.",
    "Do not shrink the design into a small card on a blank canvas. Fill the full frame like the original.",
    "Output the edited image only.",
  ];
  if (swap) {
    lines.push(
      'CRITICAL TEXT SWAP: Replace EVERY visible occurrence of the exact Persian word "' +
        swap.from +
        '" with "' +
        swap.to +
        '".'
    );
    lines.push(
      "Keep the same font style, size, color, and position as the original word. Only the letters change."
    );
    lines.push(
      'After the edit, the word "' +
        swap.from +
        '" must not appear anywhere. The word "' +
        swap.to +
        '" must appear in its place.'
    );
  }
  lines.push("User request: " + askOnly(lastText));
  return lines.join("\n\n");
}

export function collectGenerateImagePrompt(lastText: string) {
  return [
    "Render a finished professional image now.",
    "Do not reply with text, markdown, layout instructions, Word steps, or Photoshop steps.",
    "Do not describe how to build the image. Generate the actual picture.",
    "Follow the user request exactly.",
    "Do not add steel, mining, Chadormalu, CPG Pars, factories, or company branding unless the user asked for them.",
    "If Persian titles were requested, paint them clearly on the image.",
    "User request: " + askOnly(lastText),
  ].join("\n\n");
}

export function collectRecentUserAsks(
  messages?: { role?: string; content?: string }[],
  lastText = ""
) {
  const lines: string[] = [];
  for (const msg of messages || []) {
    if (msg.role !== "user") continue;
    const t = askOnly(msg.content || "");
    if (!t || t === "این عکس را بررسی کن.") continue;
    if (isImageConfirmAsk(t)) continue;
    if (t.length > 900) continue;
    lines.push(t);
  }
  const last = askOnly(lastText);
  if (last && !isImageConfirmAsk(last) && !lines.includes(last)) lines.push(last);
  return [...new Set(lines)].slice(-10);
}

const CHADOR_REVERSE_SCENES = [
  "On-site 3D scanning and dimensional capture of a worn heavy spare part at Chadormalu plant/mine. Engineers in PPE with a handheld scanner around a large metallic component in a dusty industrial yard. Documentary photorealism.",
  "Engineering CAD / reverse-engineering modeling of the same Chadormalu spare part on large screens in an industrial design office. Technical drawings, 3D mesh and cross-sections visible. No consumer gadgets.",
  "CNC machining and manufacturing of the reverse-engineered Chadormalu metal part in a workshop: chips, coolant, mill/lathe, machinists in PPE. Industrial lighting.",
  "Quality control and metallurgy lab for the same part: hardness test, microscope, gauges, inspectors checking a cut sample of the Chadormalu component.",
  "Installation and testing of the reverse-engineered part on the Chadormalu production line: technicians fitting the component onto heavy plant equipment, functional test.",
];

function userOnlyScenes(userAsk: string, n: number) {
  const ask = askOnly(userAsk);
  return Array.from({ length: n }, (_, i) =>
    [
      "Render a finished professional image now. Output an actual picture, not text.",
      "Follow this user request exactly.",
      "Do not add steel, mining, Chadormalu, CPG Pars, factories, industrial plants, or company branding unless the user asked for them.",
      n > 1
        ? "This is variation " + (i + 1) + " of " + n + " of the SAME requested subject."
        : "",
      "User request: " + ask,
      "If Persian titles were requested, paint them clearly and sparingly.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export function buildImageScenes(
  messages: { role?: string; content?: string }[] | undefined,
  lastText: string,
  count: number
) {
  const n = Math.max(1, Math.min(5, count));
  const last = askOnly(lastText);
  const industrialNow = isIndustrialImageTopic(last);
  const bare = isBareImageCommand(last);
  const asks = collectRecentUserAsks(messages, lastText);
  const industrialHistory = asks.filter((line) => isIndustrialImageTopic(line));

  if (!industrialNow && !bare) {
    return userOnlyScenes(last, n);
  }

  const industrialAsks = industrialNow ? asks.filter((line) => isIndustrialImageTopic(line) || line === last) : industrialHistory;
  const blob = industrialAsks.join("\n") || last;
  if (!isIndustrialImageTopic(blob)) {
    return userOnlyScenes(last || blob, n);
  }

  const reverse = /مهندسی معکوس|reverse engineering/i.test(blob);
  const chadormalu = /چادرملو|chadormalu/i.test(blob);
  const brief = industrialAsks.slice(-6).map((line) => "- " + line).join("\n");
  const project =
    reverse && chadormalu
      ? "Project (MUST stay identical in every image): مهندسی معکوس قطعات صنعتی مجتمع معدنی و صنعتی چادرملو (Chadormalu Mining & Industrial Co., Iran)."
      : chadormalu
        ? "Project (MUST stay identical in every image): مجتمع معدنی و صنعتی چادرملو — Chadormalu mine and plant, Iran."
        : reverse
          ? "Project (MUST stay identical in every image): industrial reverse engineering of plant spare parts:\n" +
            brief
          : "Project from the user request (MUST stay identical in every image):\n" +
            (brief || last);

  if (reverse) {
    const bodies = CHADOR_REVERSE_SCENES.slice();
    while (bodies.length < n) {
      bodies.push(
        bodies[bodies.length - 1] ||
          "Industrial documentary photograph of the same requested reverse-engineering project."
      );
    }
    return bodies.slice(0, n).map((body, i) =>
      [
        "Render a finished professional photorealistic image now. Output an actual picture, not text.",
        project,
        "This is scene " +
          (i + 1) +
          " of " +
          n +
          " of the SAME project. Different moment and composition, not a duplicate.",
        body,
        brief ? "User industrial requests:\n" + brief : "",
        "Do not invent a different industry or a random landscape.",
        "If any caption is needed, use very short readable Persian text only.",
        "Photorealistic industrial documentary photography. One complete picture.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return userOnlyScenes(last || blob, n);
}

export function isImageWorkAsk(
  text: string,
  messages?: { role?: string; content?: string; image?: string; images?: string[] }[]
) {
  const hasImg = !!(
    findLastAnyImage(messages || []) ||
    (messages || []).some((m) => collectMessageImages(m).length)
  );
  if (isImageEditAsk(text, hasImg) || isImageGenerateAsk(text)) return true;
  if (findResumeImageAsk(messages)) return true;
  const t = askOnly(text);
  if (!t) return false;
  if (hasImg && isSurgicalImageChange(t)) return true;
  if (lastAssistantWroteImagePrompt(messages) && /بساز|درست کن|اجرا|رندر|عکس|تصویر|طرح/.test(t)) {
    return true;
  }
  return false;
}

export function findLastAnyImage(
  messages: { role?: string; image?: string; images?: string[] }[]
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const imgs = collectMessageImages(messages[i]);
    if (imgs[0]) return imgs[0];
  }
  return "";
}

export function findLastUserImages(
  messages: { role?: string; image?: string; images?: string[] }[]
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    const imgs = collectMessageImages(messages[i]);
    if (imgs.length) return imgs;
  }
  return [];
}

export function collectImagePrompt(
  messages: { role?: string; content?: string; image?: string }[],
  lastText: string
) {
  const last = askOnly(lastText);
  if (!isIndustrialImageTopic(last) && !isBareImageCommand(last)) {
    return collectGenerateImagePrompt(last);
  }
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const t = askOnly(msg.content || "");
    if (!t || t === "این عکس را بررسی کن.") continue;
    if (isImageConfirmAsk(t)) continue;
    if (!isIndustrialImageTopic(t) && !isBareImageCommand(t) && t !== last) continue;
    if (t.length > 900) continue;
    lines.push(t);
  }
  let written = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.image) break;
    if (looksLikeWrittenImagePrompt(msg.content || "")) {
      written = String(msg.content || "").slice(0, 2500);
    }
    break;
  }
  const spec = [...new Set(lines)].slice(-8);
  return [
    "Render a finished professional image now.",
    "Do not reply with text, markdown, layout instructions, Word steps, or Photoshop steps.",
    "Do not describe how to build the image. Generate the actual picture.",
    "Follow the user request exactly. Do not add steel or Chadormalu unless the user asked.",
    "If Persian titles were requested, paint them clearly on the image.",
    spec.length ? "User specifications:\n" + spec.map((line) => "- " + line).join("\n") : "",
    written ? "Design prompt to execute:\n" + written : "",
    "User request: " + last,
  ]
    .filter(Boolean)
    .join("\n\n");
}


/** Multi-reference football-card / dress / background compose asks. */
export function isCompositeImageAsk(text: string) {
  const t = askOnly(text);
  if (!t) return false;
  const wantsCompose =
    /لباس .{0,20}(?:تنش|تنش کن|بپوش|بپوشون)|بک\s*گراند|بکگراند|پس[-\s]*زمینه|کارت .{0,20}(?:فوتبال|سامر|کیمدی)|مثل همون|مثل همین|از عکس .{0,40}استفاده|پرچم .{0,20}(?:شیر|خورشید|ایران)|اعداد .{0,10}100|اسم .{0,20}بشه|beck_forward|سامر\s*کیمدی|Summer\s*Kimedy/i.test(
      t
    );
  const hasPerson =
    /پسرم|دخترم|چهره|صورت|فیس|از عکس .{0,30}(?:استفاده|بگیر)|عکس (?:پسر|دختر|من)/.test(t);
  return wantsCompose || (hasPerson && /لباس|کارت|بک|پرچم|اسم/.test(t));
}

export function isShowImageAgainAsk(text: string) {
  const t = askOnly(text);
  return /عکس(?:ی که|ی|)\s*(?:درست کردی|ساختی|ویرایش).{0,20}(?:کو|کجاست|چی شد)|تصویر نهایی|مجددا(?:ً)?\s*(?:تولید|بساز|بفرست)|عکس(?:و| را)?\s*(?:دوباره|مجدد).{0,15}(?:بفرست|بساز|بده)|فقط عکس/.test(
    t
  );
}

export function collectCompositeEditPrompt(lastText: string, imageCount: number) {
  const n = Math.max(1, imageCount);
  return [
    "You are composing ONE final image from multiple attached references.",
    "Attached images are references (count=" + n + "). Identify roles from the user request:",
    "- FACE / PERSON identity photo: the real boy/person photo. Keep that exact face, skin, hair, age. Do NOT use the footballer's face from any sample card.",
    "- JERSEY / CLOTHING photo: put THAT yellow kit on the person (match colors, collar, badges if visible).",
    "- BACKGROUND photo (e.g. beck_forward): use as the card/scene background.",
    "- STYLE / LAYOUT sample card (e.g. Ronaldo Nazario Summer Kimedy card): copy layout, frame, typography placement, overall aesthetic ONLY — never keep that player's face.",
    "Apply user text constraints exactly (name, numbers/stats, flag). Example: name Adrian, all numbers 100, Iran Lion-and-Sun flag instead of the sample flag.",
    "Do not invent a different person. Do not output JSON, tool calls, or markdown — only the finished image.",
    "Do not change anything the user did not ask to change beyond composing these refs.",
    "User request:\n" + askOnly(lastText),
  ].join("\n\n");
}

/** Strip leaked fake tool-call JSON from chat replies. */
export function stripFakeToolJson(text: string) {
  let s = String(text || "");
  s = s.replace(/```(?:json)?[\s\S]*?```/gi, (block) =>
    /action_input|render_generated_image|generate_image|edit_image|render_edited_image|"action"\s*:/i.test(
      block
    )
      ? ""
      : block
  );
  s = s.replace(/`(?:json)?[\s\S]*?`/g, (block) =>
    /"action"\s*:\s*"(?:edit_image|render_edited_image|generate_image|image_edit|render_generated_image)"|action_input/i.test(
      block
    )
      ? ""
      : block
  );
  s = s.replace(
    /\{[^{}]*"(?:action|action_input|tool)"\s*:\s*"(?:edit_image|render_edited_image|generate_image|image_edit|render_generated_image)"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi,
    ""
  );
  s = s.replace(/\{\s*"action"\s*:[\s\S]*?\n\}/g, "");
  s = s.replace(/\{\s*"action_input"\s*:[\s\S]*?\n\}/g, "");
  s = s.replace(/render_generated_image|action_input/gi, "");
  s = s.replace(/در حال پردازش تصویر هستم\.\.\.?/g, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

