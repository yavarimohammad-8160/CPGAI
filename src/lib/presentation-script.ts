export const REQUIRED_SLIDE_TITLES = [
  "عنوان",
  "هدف جلسه",
  "ضرورت",
  "وضع موجود و دردها",
  "راه‌حل کلی",
  "ماژول‌ها با خروجی هر ماژول",
  "معماری / مرکز پایش",
  "KPI عددی",
  "مزایا و منافع کمی",
  "فازبندی اجرا",
  "ریسک و پیش‌نیاز",
  "تصمیم درخواستی از مدیریت",
] as const;

const OPERATIONAL_ANCHORS = [
  "چادرملو",
  "سوخت",
  "ناوگان",
  "آب",
  "آبرسانی",
  "پایش",
  "مرکز پایش",
  "مرکز پایش یکپارچه",
  "یکپارچه",
  "مرکز کنترل",
  "تله‌متری",
  "تله متري",
  "مخزن",
  "تانکر",
  "پمپاژ",
  "مصرف سوخت",
  "GPS",
  "دیسپچ",
  "حمل‌ونقل",
  "نشت",
];

const GENERIC_BANNED_WHEN_FILE = [
  "گزارش عملکرد سالانه",
  "تحقق برنامه تولید",
  "کنسانتره",
  "درآمد عملیاتی را از",
];

export function isPresentationScriptRequest(text: string) {
  const t = (text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .split("متن تصویر")[0];
  const keys = [
    "متن ارائه",
    "اسلایدبندی",
    "ارائه مدیریتی",
    "برای پاورپوینت آماده",
    "نکات سخنرانی",
    "نکته سخنرانی",
    "متن اسلاید",
    "اسکریپت ارائه",
  ];
  return keys.some((key) => t.includes(key));
}

export function hasAttachedSource(text: string) {
  return /محتوای فایل:|فایل خوانده شد|نام فایل:|متن تصویر|متن استخراج‌شده از تصویر/.test(
    text || ""
  );
}

export function looksLikeProposalSource(text: string) {
  return (
    hasAttachedSource(text) ||
    /پروپوزال|طرح پیشنهادی|پیشنهاد فنی|سند پیوست/.test(text || "")
  );
}

export function collectPresentationInput(
  messages: { role?: string; content?: string }[]
) {
  const last = String(messages[messages.length - 1]?.content || "");
  if (hasAttachedSource(last)) return last;

  for (let i = messages.length - 2; i >= 0; i--) {
    const c = String(messages[i]?.content || "");
    if (!hasAttachedSource(c) || c.length < 200) continue;
    const markers = ["نام فایل:", "محتوای فایل:", "فایل خوانده شد"];
    const start = Math.min(
      ...markers.map((key) => {
        const n = c.indexOf(key);
        return n < 0 ? Number.MAX_SAFE_INTEGER : n;
      })
    );
    const filePart =
      start < c.length ? c.slice(start) : c;
    return last + "\n\n" + filePart;
  }

  return last;
}

export function normalizeFa(text: string) {
  return (text || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/‌/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CORE_DOMAIN_GROUPS = [
  ["چادرملو"],
  ["سوخت"],
  ["ناوگان"],
  ["آب", "آبرسانی"],
  ["مرکز پایش", "پایش", "مرکز کنترل"],
];

export function requiredAnchorsFromSource(source: string) {
  const n = normalizeFa(source);
  const found: string[] = [];
  for (const group of CORE_DOMAIN_GROUPS) {
    const hit = group.find((item) => n.includes(normalizeFa(item)));
    if (hit) found.push(hit);
  }
  return found;
}

export function promptAnchorsFromSource(source: string) {
  const n = normalizeFa(source);
  const extra = OPERATIONAL_ANCHORS.filter((raw) =>
    n.includes(normalizeFa(raw))
  );
  const merged = [...requiredAnchorsFromSource(source), ...extra];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of merged) {
    const key = normalizeFa(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function tokens(text: string) {
  return normalizeFa(text)
    .split(" ")
    .map((part) => part.replace(/[^\u0600-\u06FFa-zA-Z0-9٪٪%]/g, ""))
    .filter((part) => part.length > 2);
}

function overlapRatio(a: string, b: string) {
  const left = tokens(a);
  const right = new Set(tokens(b));
  if (!left.length || !right.size) return 0;
  const hit = left.filter((item) => right.has(item)).length;
  return hit / left.length;
}

const SLIDE_HEAD = /^اسلاید\s*[0-9۰-۹]+/;

export function splitPresentationSlides(script: string) {
  return (script || "")
    .replace(/\r\n/g, "\n")
    .split(/^(?=اسلاید\s*[0-9۰-۹]+)/m)
    .map((part) => part.trim())
    .filter((part) => SLIDE_HEAD.test(part));
}

function parseSlideParts(slide: string) {
  const lines = slide.split("\n").map((line) => line.trim()).filter(Boolean);
  const items: string[] = [];
  const notes: string[] = [];
  let inNote = false;
  for (const line of lines) {
    if (/نکته سخنرانی/.test(line)) {
      inNote = true;
      const rest = line.replace(/^[-•\s]*نکته سخنرانی:?\s*/i, "").trim();
      if (rest && !/^نکته سخنرانی:?$/i.test(rest)) notes.push(rest);
      continue;
    }
    if (inNote) {
      notes.push(line.replace(/^[-•\s]+/, ""));
      continue;
    }
    if (/^-?\s*(عنوان|زیرعنوان|مخاطب|بولت)/.test(line)) continue;
    if (
      /^[-•]/.test(line) ||
      /خروجی\s*:/.test(line) ||
      /^\d+[\.\)]/.test(line)
    ) {
      const item = line.replace(/^[-•\s\d\.]+/, "").trim();
      if (item) items.push(item);
    }
  }
  return {
    items,
    bullets: items.join(" "),
    note: notes.join(" "),
  };
}

function sourceHasDomain(source: string, word: string) {
  return normalizeFa(source).includes(normalizeFa(word));
}

function isNumericKpi(text: string) {
  return (
    /[0-9۰-۹]/.test(text) &&
    (/[|｜]/.test(text) ||
      /درصد|٪|لیتر|ساعت|متر|دستگاه|هفته|ماه|میلیون|میلیارد|نفر/.test(text))
  );
}

export function harvestSourceFacts(source: string) {
  const interesting: string[] = [];
  const seen = new Set<string>();
  const keys = [
    /سوخت/,
    /ناوگان/,
    /آب/,
    /آبرسانی/,
    /پایش/,
    /مرکز/,
    /ماژول/,
    /شاخص|KPI/i,
    /فاز/,
    /ریسک/,
    /پیش[ -]?نیاز/,
    /درصد|٪|میلیون|میلیارد|لیتر|مترمکعب/,
    /چادرملو/,
    /خروجی/,
    /GPS|تله/,
    /مخزن/,
    /تانکر/,
    /پمپ/,
    /مصرف/,
    /معماری/,
    /یکپارچه/,
    /دیسپچ/,
    /نشت/,
    /هدف/,
    /ضرورت/,
    /پیامد/,
    /قابلیت/,
    /نفع/,
    /منافع/,
    /اقدام/,
    /هفته|ماه/,
    /برآورد/,
  ];

  for (const raw of (source || "").split(/\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 14 || line.length > 280) continue;
    if (!keys.some((key) => key.test(line))) continue;
    const sig = normalizeFa(line).slice(0, 80);
    if (seen.has(sig)) continue;
    seen.add(sig);
    interesting.push(line);
    if (interesting.length >= 64) break;
  }

  return interesting.join("\n");
}

export function sourceBriefPrompt() {
  return [
    "تو استخراج‌کننده دقیق پروپوزال برای ارائه به مدیرعامل هستی.",
    "فقط از متن منبع استخراج کن. کلی‌گویی و گزارش عملکرد سالانه ممنوع است.",
    "اگر عدد دقیق در فایل نیست، یک برآورد منطقی بنویس و کنارش بگذار (برآورد).",
    "اگر بندی اصلاً در فایل نیست بنویس: در فایل نیامده؛ سپس برآورد نمونه بده.",
    "نام کارفرما، سایت، ماژول و سامانه را حذف نکن.",
    "اگر سند درباره سوخت، ناوگان، آب یا مرکز پایش است این حوزه‌ها را جداگانه و کامل نگه دار.",
    "خروجی فارسی ساخت‌یافته با همین سرفصل‌ها:",
    "کارفرما / سایت:",
    "عنوان طرح:",
    "هدف جلسه (تصمیم مورد نیاز):",
    "ضرورت (هزینه بی‌عملی):",
    "وضع موجود:",
    "- سوخت: درد مشخص | پیامد عملی",
    "- ناوگان: درد مشخص | پیامد عملی",
    "- آب: درد مشخص | پیامد عملی",
    "راه‌حل کلی و نقش مرکز پایش یکپارچه:",
    "ماژول‌ها (هر مورد کامل):",
    "- نام | قابلیت اصلی | خروجی ملموس | نفع مدیریتی",
    "معماری / مرکز پایش (منابع داده، داشبورد، هشدار):",
    "KPI (حداقل ۵ شاخص):",
    "- شاخص | عدد | واحد | مبنای مقایسه | منبع عدد یا (برآورد)",
    "منافع کمی (حداقل ۳، با عدد):",
    "منافع کیفی (حداقل ۲، غیرشعاری):",
    "فازبندی:",
    "- فاز | هدف | خروجی قابل تحویل | برآورد زمانی",
    "ریسک‌ها (حداقل ۴):",
    "- ریسک | اقدام کنترلی",
    "پیش‌نیاز شروع:",
    "تصمیم درخواستی از مدیریت:",
    "اقدام ۳۰ روز آینده:",
    "جزئیات خاص که نباید گم شود:",
  ].join("\n");
}

export function presentationScriptPrompt(userText: string) {
  const fromFile = looksLikeProposalSource(userText);
  const anchors = promptAnchorsFromSource(userText);
  return [
    "تو نویسنده متن ارائه برای جلسه مدیرعامل / کارفرما هستی.",
    "خروجی باید تصمیم‌پذیر باشد، نه بروشور و نه خلاصه کلی.",
    "فقط متن اسلایدها را بنویس. جمله گفتگو ننویس.",
    fromFile
      ? "محتوا را از فایل و خلاصه استخراج بساز. صنعت نامرتبط و گزارش عملکرد سالانه ممنوع است. جزئیات همان پروژه (نام سایت، ماژول، حوزه عملیاتی) باید دیده شود."
      : "اگر داده واقعی نبود، نمونه صنعتی مشخص بساز. برند شرکت را ننویس مگر در منبع باشد.",
    "اگر عدد عیناً در منبع آمده، بدون برچسب بنویس. اگر عدد دقیق نبود، عدد منطقی بده و حتماً (برآورد) یا (نمونه) بگذار. اسلاید را به‌خاطر نبود عدد خالی نگذار.",
    anchors.length
      ? "این واژه‌ها حتماً بمانند: " + anchors.join("، ") + "."
      : "",
    "فارسی رسمی، کوتاه، اجرایی. هر بولت یک خط: فعل یا درد مشخص + مصداق + عدد یا خروجی.",
    "کلی‌گویی ممنوع: «بهبود فرآیندها»، «افزایش بهره‌وری»، «ارتقای کیفیت» بدون مصداق مردود است.",
    "تکرار یک مضمون در دو اسلاید ممنوع است. هر اسلاید فقط یک وظیفه دارد.",
    "دقیقاً ۱۲ اسلاید را کامل بنویس؛ خروجی ناقص مردود است.",
    "سرعنوان هر اسلاید دقیقاً با رقم انگلیسی: اسلاید 1: عنوان",
    "عنوان اسلاید را عوض نکن.",
    "اسلاید 1: عنوان",
    "اسلاید 2: هدف جلسه",
    "اسلاید 3: ضرورت",
    "اسلاید 4: وضع موجود و دردها",
    "اسلاید 5: راه‌حل کلی",
    "اسلاید 6: ماژول‌ها با خروجی هر ماژول",
    "اسلاید 7: معماری / مرکز پایش",
    "اسلاید 8: KPI عددی",
    "اسلاید 9: مزایا و منافع کمی",
    "اسلاید 10: فازبندی اجرا",
    "اسلاید 11: ریسک و پیش‌نیاز",
    "اسلاید 12: تصمیم درخواستی از مدیریت",
    "قالب مشترک هر اسلاید غیرعنوان:",
    "- عنوان:",
    "- بولت‌ها:",
    "  - ...",
    "- نکته سخنرانی:",
    "اسلاید ۱: عنوان پروژه + کارفرما/سایت + نتیجه جلسه (تصویب چه چیزی).",
    "اسلاید ۲ هدف جلسه: ۳ بولت اجرایی؛ جلسه برای تصمیم است نه معرفی نرم‌افزار.",
    "اسلاید ۳ ضرورت: هزینه یا ریسک بی‌عملی با مصداق عملیاتی.",
    "اسلاید ۴ وضع موجود: اگر پروژه سوخت/ناوگان/آب است، دقیقاً سه بولت جدا:",
    "  - سوخت: [درد مشخص] — پیامد: [توقف/هدررفت/هزینه]",
    "  - ناوگان: [درد مشخص] — پیامد: [...]",
    "  - آب: [درد مشخص] — پیامد: [...]",
    "اسلاید ۵ راه‌حل: لایه یکپارچه + نقش مرکز پایش؛ سه حوزه را به یک فرمان وصل کن.",
    "اسلاید ۶ ماژول‌ها: حداقل ۳ ماژول؛ هر بولت کامل:",
    "  - [نام] — قابلیت: ... — خروجی: ... — نفع مدیریتی: ...",
    "اسلاید ۷ معماری: منبع داده هر حوزه، تجمیع در مرکز پایش یکپارچه، هشدار لحظه‌ای، نقش اتاق کنترل.",
    "اسلاید ۸ KPI: حداقل ۵ شاخص. قالب هر خط: شاخص | عدد | واحد | مبنای مقایسه. حوزه‌ها: سوخت، ناوگان، آب، پایش. اگر عدد منبع نبود (برآورد) بگذار.",
    "اسلاید ۹ منافع: حداقل ۳ نفع کمی با عدد و واحد (برچسب کمی:) و حداقل ۲ نفع کیفی غیرشعاری (برچسب کیفی:). کیفی باید اثر مدیریتی مشخص باشد نه شعار.",
    "اسلاید ۱۰ فازبندی: حداقل ۳ فاز. هر فاز: هدف + خروجی قابل تحویل + برآورد زمانی (هفته/ماه، نمونه اگر در فایل نبود).",
    "اسلاید ۱۱ ریسک: حداقل ۴ ریسک. هر خط: ریسک: ... — اقدام کنترلی: ...",
    "اسلاید ۱۲ تصمیم: دقیقاً سه بولت:",
    "  - تصمیم درخواستی: تصویب چه چیزی، با چه محدوده و بودجه‌ای",
    "  - اقدام ۳۰ روز آینده: کارهای مشخص شروع",
    "  - پیش‌نیاز شروع: دسترسی داده/سایت/مالک کسب‌وکار",
    "نکته سخنرانی تکرار بولت مردود است. ۳ تا ۴ جمله تحلیلی: ریشه مسئله یا هزینه بی‌عملی؛ نکته‌ای که روی اسلاید جا نشده؛ پیام برای تصمیم‌گیر؛ انتقال یک‌خطی به اسلاید بعد. حداقل ۱۴۰ نویسه.",
    "حداکثر ۶ بولت در هر اسلاید. نکته سخنرانی روی اسلاید نمی‌آید.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type ScriptQuality = {
  ok: boolean;
  hardFail: boolean;
  issues: string[];
  slideCount: number;
};

export function presentationScriptQuality(
  script: string,
  source: string
): ScriptQuality {
  const issues: string[] = [];
  const slides = splitPresentationSlides(script);
  const fromFile = looksLikeProposalSource(source);
  const nScript = normalizeFa(script);
  const parsed = slides.map((slide) => parseSlideParts(slide));

  if (slides.length < 12) {
    issues.push("باید دقیقاً ۱۲ اسلاید با عنوان‌های الزامی باشد.");
  }

  REQUIRED_SLIDE_TITLES.forEach((title, index) => {
    const expected = normalizeFa("اسلاید " + (index + 1) + ": " + title);
    const header = normalizeFa(slides[index]?.split("\n")[0] || "");
    if (!header.includes(normalizeFa(title)) && !nScript.includes(expected)) {
      issues.push("اسلاید " + (index + 1) + " باید «" + title + "» باشد.");
    }
  });

  const pain = parsed[3];
  if (pain) {
    const painText = pain.bullets + slides[3];
    const domains = [
      sourceHasDomain(source, "سوخت") ? "سوخت" : "",
      sourceHasDomain(source, "ناوگان") ? "ناوگان" : "",
      sourceHasDomain(source, "آب") || sourceHasDomain(source, "آبرسانی")
        ? "آب"
        : "",
    ].filter(Boolean);
    for (const domain of domains) {
      if (!painText.includes(domain)) {
        issues.push("اسلاید وضع موجود باید درد حوزه «" + domain + "» را جدا بیاورد.");
      }
    }
    const consequenceHits = pain.items.filter((item) =>
      /پیامد|منجر|هدررفت|توقف|هزینه|نشت|کمبود/.test(item)
    ).length;
    if (consequenceHits < Math.max(2, domains.length || 2)) {
      issues.push("اسلاید وضع موجود باید پیامد عملی هر درد را داشته باشد.");
    }
  }

  const modules = parsed[5];
  if (modules) {
    const complete = modules.items.filter(
      (item) =>
        /خروجی/.test(item) &&
        /نفع/.test(item) &&
        /قابلیت|کارکرد/.test(item)
    );
    if (complete.length < 3) {
      issues.push(
        "اسلاید ماژول‌ها باید حداقل ۳ ماژول با قابلیت، خروجی ملموس و نفع مدیریتی داشته باشد."
      );
    }
  }

  const arch = slides[6] || "";
  if (slides.length >= 7 && !/پایش|معماری|مرکز/.test(arch)) {
    issues.push("اسلاید معماری باید مرکز پایش یا معماری سامانه را توضیح دهد.");
  }

  const kpi = parsed[7];
  if (kpi) {
    const numeric = kpi.items.filter(isNumericKpi);
    if (numeric.length < 5) {
      issues.push("اسلاید KPI باید حداقل ۵ شاخص با عدد، واحد و مبنای مقایسه داشته باشد.");
    }
    const kpiText = kpi.bullets;
    for (const domain of ["سوخت", "ناوگان", "آب", "پایش"] as const) {
      if (sourceHasDomain(source, domain) && !kpiText.includes(domain)) {
        issues.push("اسلاید KPI باید شاخص مرتبط با «" + domain + "» داشته باشد.");
      }
    }
    if (
      !/[0-9۰-۹]/.test(source) &&
      !/برآورد|نمونه/.test(kpiText)
    ) {
      issues.push("اعداد بدون منبع باید با برچسب برآورد یا نمونه مشخص شوند.");
    }
  }

  const benefit = parsed[8];
  if (benefit) {
    const qty = benefit.items.filter(
      (item) => /کمی/.test(item) && /[0-9۰-۹]/.test(item)
    );
    const qual = benefit.items.filter((item) => /کیفی/.test(item));
    if (qty.length < 3) {
      issues.push("اسلاید منافع باید حداقل ۳ نفع کمی با عدد داشته باشد.");
    }
    if (qual.length < 2) {
      issues.push("اسلاید منافع باید حداقل ۲ نفع کیفی غیرشعاری داشته باشد.");
    }
  }

  const phase = parsed[9];
  if (phase) {
    const phases = phase.items.filter((item) => /فاز/.test(item));
    const timed = phase.items.filter((item) =>
      /هفته|ماه|روز|زمان/.test(item)
    );
    const goals = phase.items.filter((item) => /هدف/.test(item));
    const outputs = phase.items.filter((item) => /خروجی/.test(item));
    if (
      phases.length < 3 ||
      timed.length < 3 ||
      goals.length < 3 ||
      outputs.length < 3
    ) {
      issues.push(
        "اسلاید فازبندی باید حداقل ۳ فاز با هدف، خروجی و برآورد زمانی داشته باشد."
      );
    }
  }

  const risk = parsed[10];
  if (risk) {
    const controls = risk.items.filter((item) => /اقدام/.test(item));
    if (risk.items.length < 4 || controls.length < 4) {
      issues.push("اسلاید ریسک باید حداقل ۴ ریسک همراه اقدام کنترلی داشته باشد.");
    }
  }

  const decision = parsed[11];
  if (decision) {
    const text = normalizeFa(decision.bullets + " " + (slides[11] || ""));
    if (!/تصویب|مجوز|بودجه|تصمیم/.test(text)) {
      issues.push("اسلاید آخر باید تصمیم مشخص از مدیریت بخواهد.");
    }
    if (!/۳۰ روز|30 روز|سی روز/.test(text)) {
      issues.push("اسلاید تصمیم باید اقدام ۳۰ روز آینده را داشته باشد.");
    }
    if (!/پیشنیاز/.test(text)) {
      issues.push("اسلاید تصمیم باید پیش‌نیاز شروع را داشته باشد.");
    }
  }

  let repeatedNotes = 0;
  let shortNotes = 0;
  for (const part of parsed) {
    if (!part.note || part.note.length < 140) shortNotes += 1;
    if (
      part.note &&
      part.bullets &&
      overlapRatio(part.note, part.bullets) >= 0.55
    ) {
      repeatedNotes += 1;
    }
  }
  if (shortNotes >= 3) {
    issues.push(
      "نکته سخنرانی چند اسلاید خیلی کوتاه است؛ باید ۳ تا ۴ جمله تحلیلی باشد."
    );
  }
  if (repeatedNotes >= 3) {
    issues.push("نکته سخنرانی چند اسلاید تکرار بولت است؛ باید ارزش تحلیلی داشته باشد.");
  }

  if (fromFile) {
    for (const banned of GENERIC_BANNED_WHEN_FILE) {
      if (script.includes(banned) && !source.includes(banned)) {
        issues.push("خروجی به نمونه عمومی منحرف شده است: " + banned);
      }
    }
    const anchors = requiredAnchorsFromSource(source);
    const missing = anchors.filter(
      (item) => !nScript.includes(normalizeFa(item))
    );
    if (missing.length) {
      issues.push("جزئیات منبع در ارائه نیست: " + missing.join("، "));
    }
  }

  const hardFail =
    slides.length < 12 ||
    issues.some(
      (item) =>
        item.includes("جزئیات منبع") ||
        item.includes("نمونه عمومی") ||
        item.includes("عنوان‌های الزامی") ||
        item.includes("باید «")
    );

  return {
    ok: issues.length === 0,
    hardFail,
    issues,
    slideCount: slides.length,
  };
}

export function retryInstruction(issues: string[], fromFile: boolean) {
  return [
    "خروجی قبلی از نظر عمق مردود است. از نو بنویس؛ ساختار ۱۲ اسلاید را نگه دار و محتوا را غنی کن.",
    fromFile
      ? "جزئیات همان پروژه را از خلاصه و شواهد فایل بیاور. کلی‌گویی نکن."
      : "اسلایدها را با مصداق عملیاتی و عدد (برآورد) پر کن.",
    "اسلاید وضع موجود: درد سوخت، ناوگان و آب جدا + پیامد عملی.",
    "اسلاید ماژول: قابلیت + خروجی + نفع مدیریتی برای هر ماژول.",
    "KPI: حداقل ۵ شاخص با عدد و واحد.",
    "منافع: ۳ کمی عددی + ۲ کیفی.",
    "فاز: هدف + خروجی + زمان. ریسک: ۴ مورد با اقدام کنترلی.",
    "تصمیم: خواسته دقیق + اقدام ۳۰ روز + پیش‌نیاز شروع.",
    "نکته سخنرانی تحلیلی باشد؛ تکرار بولت ممنوع است.",
    "ایرادها:",
    ...issues.map((item) => "- " + item),
  ].join("\n");
}
