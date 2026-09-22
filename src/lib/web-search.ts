import { noteSearchUsed } from "@/lib/usage";

const AVALAI_BASE = "https://api.avalai.ir/v1";

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
};

export type ExtractedStat = {
  raw: string;
  year: string;
  kind: "actual" | "capacity" | "plan" | "estimate" | "unknown";
  sourceTitle: string;
  sourceUrl: string;
};

export type WebSearchResult =
  | { ok: true; hits: WebHit[]; stats: ExtractedStat[]; note?: string }
  | { ok: false; disabled: boolean; error: string };

const SEARCH_TOOLS = [
  process.env.AVALAI_SEARCH_TOOL,
  "serper-search",
  "tavily-search",
  "perplexity-search",
].filter((tool, i, arr): tool is string => !!tool && arr.indexOf(tool) === i);

function askText(text: string) {
  return (text || "").split("محتوای فایل:")[0].split("نام فایل:")[0];
}

export function needsWebSearch(text: string) {
  const t = askText(text);
  if (!t.trim()) return false;

  if (
    /ویندوز|\bwindows\b|taskbar|تسک‌بار|نوار وظیفه|default apps?|دیفالت|پیش‌فرض برنامه|اپ پیش‌فرض|گروپ\s*پالیسی|\bgpo\b|تنظیمات ویندوز|عیب‌یابی نرم‌افزار/i.test(
      t
    )
  ) {
    return false;
  }

  // Shopping / Iranian site browsing / live price compare
  if (
    /بگرد|جستجو\s*کن|سرچ\s*کن|سایت[-\s]*های\s*ایرانی|روی\s*سایت|وی\s*سایت|ارزان[-\s]*ترین|ارزانترین|اقساطی|قسطی|خرید\s*اکانت|فروش\s*اکانت|مقایسه\s*قیمت|معرفی\s*سایت|کدام\s*سایت|بهترین\s*سایت|فروشگاه\s*آنلاین|دیجی[-\s]*کالا|اسنپ[-\s]*پی/i.test(
      t
    )
  ) {
    return true;
  }

  const wantsLive =
    /آمار|رقم|میزان|ظرفیت|تعداد|درصد|قیمت|نرخ|تورم|تناژ|سالانه|آخرین گزارش|آخرین آمار|کدال|گزارش رسمی|گزارش فعالیت|اعلام‌شده|اعلام شده|تولید واقعی|ظرفیت اسمی|به‌روز|به روز/.test(
      t
    );

  if (
    /چالش|اولویت|پیشنهاد می‌کنی|چگونه بهبود|چطور بهبود|بهبود دهیم|راهبرد|استراتژی|گلوگاه|آسیب‌شناس|چه باید کرد/.test(
      t
    ) &&
    !wantsLive
  ) {
    return false;
  }

  return wantsLive;
}

export function isWebRefusal(text: string) {
  return /نمی‌توانم به (وب|سایت|اینترنت)|نمي‌توانم به (وب|سایت|اینترنت)|دسترسی به (وب|سایت|اینترنت|وب‌سایت)|قادر به دسترسی|سایت را باز کنم|مرورگر ندارم|به وب‌سایت دسترسی|به سایت دسترسی ندارم|اینترنت زنده|موتورهای جستجو|ابزارهای استعلام|کلیدواژه‌های زیر را مستقیماً در گوگل|در گوگل (جستجو|سرچ) کنید|در گوگل سرچ|گوگل سرچ کنید|عبارت زیر را در گوگل|لطفاً عبارت زیر را|پیشنهاد می‌کنم برای پیدا کردن|به اینترنت دسترسی ندارم|دسترسی ندارم و نمی‌توانم/.test(
    text || ""
  );
}

/** Iranian site browsing / price compare / installment shopping ask. */
export function isShoppingBrowseAsk(text: string) {
  const t = askText(text);
  return /بگرد|سایت[-\s]*های\s*ایرانی|وی\s*سایت|روی\s*سایت|ارزان[-\s]*ترین|ارزانترین|اقساطی|قسطی|خرید\s*اکانت|فروش\s*اکانت|معرفی\s*سایت|کدام\s*سایت|بهترین\s*سایت|مقایسه\s*قیمت/i.test(
    t
  );
}

/** True if the assistant reply actually cites at least one searched result. */
export function answerUsesSearchHits(answer: string, hits: WebHit[]) {
  const a = String(answer || "").toLowerCase();
  if (!a.trim() || !hits?.length) return false;
  return hits.some((h) => {
    try {
      const host = new URL(h.url).hostname.replace(/^www\./, "").toLowerCase();
      if (host && a.includes(host)) return true;
    } catch {
      /* ignore */
    }
    const title = String(h.title || "").slice(0, 24);
    return title.length >= 8 && a.includes(title.toLowerCase());
  });
}

/** Strip accidental provider/model identity leaks from assistant replies. */

export function formatShoppingFallback(hits: WebHit[], ask: string) {
  const list = (hits || []).filter((h) => h?.url && h?.title).slice(0, 8);
  if (!list.length) {
    return "نتیجه معتبری از سایت‌های ایرانی برای این جستجو پیدا نشد. کمی بعد دوباره امتحان کنید.";
  }
  const installment = list.filter((h) =>
    /اقساط|قسط|اسنپ\s*پی|ازکی|نخل\s*کارت|توبانک|دیجی\s*پی|خرید\s*قسطی/i.test(
      `${h.title} ${h.snippet}`
    )
  );
  const priceHits = list.filter((h) =>
    /[۰-۹0-9]{3,}/.test(`${h.title} ${h.snippet}`) &&
    /قیمت|تومان|تومن|٪|%|قسط/i.test(`${h.title} ${h.snippet}`)
  );
  const lines = [
    "بر اساس جستجوی همین الان در سایت‌های ایرانی:",
    "",
  ];
  if (priceHits[0]) {
    lines.push(
      "از بین نتایج فعلی، برای شروع مقایسه قیمت این را ببین: " +
        priceHits[0].title +
        " — " +
        priceHits[0].url
    );
    lines.push("");
  }
  list.forEach((h, i) => {
    lines.push(`${i + 1}) ${h.title}`);
    lines.push(h.url);
    if (h.snippet) lines.push(h.snippet.slice(0, 180));
    lines.push("");
  });
  if (installment.length) {
    lines.push("سایت‌هایی که در نتایج به خرید اقساطی اشاره داشتند:");
    installment.forEach((h) => lines.push(`- ${h.title} — ${h.url}`));
    lines.push("");
  } else {
    lines.push(
      "در اسنیپت‌های فعلی عبارت اقساطی واضح نبود؛ برای قسطی، صفحات محصول را مستقیم چک کنید (اسنپ‌پی و مشابه)."
    );
    lines.push("");
  }
  lines.push(
    "برای ارزان‌ترین گزینه: قیمت‌ها لحظه‌ای عوض می‌شوند؛ از بین لینک‌های بالا صفحه محصول را باز کنید و قیمت نهایی را مقایسه کنید. اگر چند قیمت در اسنیپت بود، همان را مبنا بگیرید."
  );
  if (/FC\s*27|اف\s*سی\s*۲۷|اف\s*سی\s*27/i.test(ask)) {
    lines.push(
      "نکته: FC 27 در نتایج به‌صورت پیش‌خرید/نسخه‌های قانونی دیده می‌شود؛ قبل از پرداخت، پلتفرم (PS4/PS5) و نوع اکانت را از خود فروشگاه تأیید کنید."
    );
  }
  return lines.join("\n");
}

export function stripProviderLeak(text: string) {
  let s = String(text || "");
  // Drop any line that names providers/models
  s = s
    .split(/\n/)
    .filter(
      (line) =>
        !/(?:Sinox|sinox|AvalAI|GapGPT|\bGrok\b|گروک|t-grok|grok-\d|Sinox\s*API)/i.test(
          line
        )
    )
    .join("\n");
  s = s.replace(/\([^\n)]{0,240}(?:Sinox|sinox|AvalAI|GapGPT|Grok|grok|گروک)[^\n)]{0,240}\)/gi, "");
  s = s.replace(/من از طریق[^\n.]{0,200}\.?/gi, "");
  s = s.replace(/مدل زبانی[^\n.]{0,120}\.?/gi, "");
  s = s.replace(/\b(?:t-)?grok[-\s]?\d(?:\.\d)?\b/gi, "");
  s = s.replace(/\bSinox\s*API\b/gi, "");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function topicCore(question: string) {
  return question
    .replace(
      /چقدر(ه)?|میزان|عدد دقیق|جستجو کن|از اینترنت|به‌روز|به روز|پیدا کن|خودت|بررسی کن|لطفاً|لطفا/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isChadormaluBilletAsk(question: string) {
  return /چادرملو|کچاد/.test(question) && /شمش/.test(question);
}

function buildSearchQueries(question: string) {
  const q = askText(question).replace(/[؟?]/g, " ").replace(/\s+/g, " ").trim();
  if (isChadormaluBilletAsk(q)) {
    return [
      '"تولید شمش" چادرملو ۱۴۰۲',
      '"تولید شمش" چادرملو ۱۴۰۳',
      '"یک میلیون" شمش چادرملو تولید',
      "کچاد تولید شمش کدال",
      '"شمش فولادی" چادرملو "هزار تن"',
    ];
  }

  if (/آهن اسفنجی|احیای مستقیم|\bDRI\b/.test(q)) {
    return [
      "تولید آهن اسفنجی ایران ۱۴۰۳ ۱۴۰۲",
      "فولاد مبارکه آهن اسفنجی تولید هزار تن",
      "فولاد خوزستان ارفع آهن اسفنجی DRI",
      "چادرملو گل‌گهر جهان فولاد آهن اسفنجی تولید",
    ];
  }

  if (/اکانت|FC\s*2[567]|فیفا|Ultimate\s*Team|اقساطی|قسطی|ارزان[-\s]*ترین|خرید\s*بازی|سایت[-\s]*های\s*ایرانی|بگرد/i.test(q)) {
    return [
      q,
      topicCore(q) + " خرید اقساطی",
      topicCore(q) + " ارزان قیمت سایت ایرانی",
      "خرید اکانت FC Ultimate Team اقساطی ایران",
      "ارزانترین سایت خرید اکانت فیفا اف سی ایران",
    ];
  }

  const topic = topicCore(q) || q;
  const queries = [q, topic + " ۱۴۰۳ ۱۴۰۲", topic + " آخرین گزارش"];

  if (/تورم|نقدینگی|نرخ بهره|بانک مرکزی/.test(q)) {
    queries.push("نرخ تورم ایران بانک مرکزی آخرین اعلام site:cbi.ir");
  } else if (/بیکاری|جمعیت|شاخص قیمت|مرکز آمار/.test(q)) {
    queries.push(topic + " مرکز آمار ایران site:amar.org.ir");
  } else if (/چادرملو/.test(q) && /گندله/.test(q)) {
    queries.push("site:codal.ir چادرملو تولید گندله گزارش فعالیت");
  } else if (/چادرملو/.test(q)) {
    queries.push("site:codal.ir چادرملو گزارش فعالیت ماهانه");
  } else if (/تولید سالانه|میزان تولید/.test(q)) {
    queries.push(topic + " هزار تن تولید");
    queries.push(topic + " میلیون تن");
  } else {
    queries.push(topic + " گزارش رسمی کدال");
  }

  return [...new Set(queries.map((item) => item.replace(/\s+/g, " ").trim()))]
    .filter(Boolean)
    .slice(0, isChadormaluBilletAsk(q) ? 5 : 4);
}

function sourceRank(hit: WebHit) {
  const blob = (hit.url + " " + hit.title).toLowerCase();
  if (
    /codal\.ir|cbi\.ir|amar\.org\.ir|gov\.ir|mimt\.gov|mporg\.ir|stats\.gov/.test(
      blob
    )
  ) {
    return 0;
  }
  if (
    /گزارش فعالیت|هیئت مدیره|هیئت‌مدیره|اطلاعیه|گزارش سالانه|سالنامه|official|annual report/.test(
      hit.title + " " + blob
    )
  ) {
    return 1;
  }
  if (
    /donya-e-eqtesad|eghtesadonline|boursepress|irna|mehrnews|isna|tasnim|tedan|navasan|shana|bourseview|farsnews|yjc\.ir|tejaratnews/.test(
      blob
    )
  ) {
    return 2;
  }
  return 3;
}

function mergeHits(groups: WebHit[][]) {
  const seen = new Set<string>();
  const hits: WebHit[] = [];
  for (const group of groups) {
    for (const hit of group) {
      const key = hit.url || hit.title + hit.snippet;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  return hits.sort((a, b) => sourceRank(a) - sourceRank(b));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function collectLists(data: Record<string, unknown>) {
  const lists: unknown[] = [];
  for (const key of [
    "results",
    "organic",
    "organic_results",
    "data",
    "items",
    "web",
  ]) {
    if (Array.isArray(data[key])) lists.push(...(data[key] as unknown[]));
  }
  const nested = asRecord(data.data);
  if (nested) {
    for (const key of ["results", "organic"]) {
      if (Array.isArray(nested[key])) lists.push(...(nested[key] as unknown[]));
    }
  }
  return lists;
}

export function normalizeSearchHits(payload: unknown): WebHit[] {
  const data = asRecord(payload);
  if (!data) return [];
  const hits: WebHit[] = [];
  const seen = new Set<string>();

  for (const item of collectLists(data)) {
    const row = asRecord(item);
    if (!row) continue;
    const title = str(row.title) || str(row.name);
    const url = str(row.url) || str(row.link) || str(row.href);
    const snippet =
      str(row.snippet) ||
      str(row.content) ||
      str(row.description) ||
      str(row.text);
    const key = url || title + snippet;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!title && !snippet) continue;
    hits.push({ title: title || url, url, snippet: snippet.slice(0, 1400) });
  }

  const box = asRecord(data.answerBox) || asRecord(data.answer_box);
  if (box) {
    const snippet = str(box.answer) || str(box.snippet) || str(box.content);
    if (snippet) {
      hits.unshift({
        title: str(box.title) || "جعبه پاسخ",
        url: str(box.link) || str(box.url),
        snippet,
      });
    }
  }

  return hits.slice(0, 8);
}

function looksDisabled(status: number, body: string) {
  if ([401, 402, 403, 429].includes(status)) return true;
  if (status === 404) return false;
  return /not enabled|not available|disabled|insufficient credit|quota|search tool is not/i.test(
    body
  );
}

function looksRefusalHit(hit: WebHit) {
  return isWebRefusal(hit.title + " " + hit.snippet);
}

async function postJson(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
) {
  const response = await fetch(AVALAI_BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let json: unknown = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }
  return { ok: response.ok, status: response.status, json, raw };
}

async function searchWithTool(apiKey: string, query: string, tool: string) {
  const bodies: Record<string, unknown>[] = [
    { query, max_results: 8, hl: "fa", gl: "ir" },
    { search_tool_name: tool, query, max_results: 8, hl: "fa" },
  ];
  const paths = ["/search/" + tool, "/search"];
  let disabled = false;
  let error = "";

  for (const path of paths) {
    for (const body of bodies) {
      if (path === "/search" && !("search_tool_name" in body)) continue;
      if (path !== "/search" && "search_tool_name" in body) continue;
      try {
        const res = await postJson(apiKey, path, body);
        if (res.ok) {
          const hits = normalizeSearchHits(res.json).filter(
            (hit) => !looksRefusalHit(hit)
          );
          if (hits.length) return { hits, disabled: false as const, error: "" };
        }
        if (looksDisabled(res.status, res.raw + JSON.stringify(res.json))) {
          disabled = true;
          error =
            "ابزار جستجو (" +
            tool +
            ") خطا داد: وضعیت " +
            res.status +
            ".";
        }
      } catch (err) {
        error = err instanceof Error ? err.message : "خطای شبکه در جستجو.";
      }
    }
  }
  return { hits: [] as WebHit[], disabled, error };
}

async function searchWithGroundedModel(
  apiKey: string,
  query: string,
  model: string
) {
  try {
    const res = await postJson(apiKey, "/chat/completions", {
      model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "وب را جستجو کن و فقط بر اساس نتایج جواب بده.",
            "نوع داده را جدا کن: مقدار واقعی، ظرفیت اسمی، برنامه/پیش‌بینی، برآورد غیررسمی.",
            "عدد را با زمان/سال و نام منبع بنویس.",
            "ظرفیت اسمی را با مقدار واقعی یکی نکن.",
            "رقم از حافظه نساز. اگر قطعی نبود بگو یافت نشد.",
          ].join(" "),
        },
        { role: "user", content: query },
      ],
    });
    const data = asRecord(res.json) || {};
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    const text = str(message?.content);
    if (res.ok && text && !isWebRefusal(text)) {
      const citations = Array.isArray(data.citations) ? data.citations : [];
      const extra = citations
        .map((item) => str(item))
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ");
      return {
        hits: [
          {
            title: "نتیجه جستجوی " + model,
            url: extra,
            snippet: text.slice(0, 2500),
          },
        ],
        disabled: false as const,
        error: "",
      };
    }
    if (looksDisabled(res.status, res.raw)) {
      return {
        hits: [] as WebHit[],
        disabled: true as const,
        error: "مدل جستجو (" + model + ") خطا داد: وضعیت " + res.status + ".",
      };
    }
  } catch (err) {
    return {
      hits: [] as WebHit[],
      disabled: false as const,
      error: err instanceof Error ? err.message : "خطای شبکه در مدل جستجو.",
    };
  }
  return { hits: [] as WebHit[], disabled: false as const, error: "" };
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toEnDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (ch) => String(FA_DIGITS.indexOf(ch)))
    .replace(/[٬،]/g, ",");
}

function kindFromContext(context: string): ExtractedStat["kind"] {
  if (/ظرفیت اسمی|ظرفیت طراحی|ظرفیت نصب|nameplate/.test(context)) return "capacity";
  if (/برنامه|پیش‌بینی|هدف‌گذاری|هدف تولید/.test(context)) return "plan";
  if (/برآورد|حدودا|تقریباً|تقریبا/.test(context)) return "estimate";
  if (/تولید کرد|تولید شده|تولید سال|میزان تولید|به تولید|تولید شمش|تولید گندله/.test(context)) {
    return "actual";
  }
  return "unknown";
}

function yearFromContext(context: string) {
  const match = context.match(/۱۴۰[۰-۹]|140[0-9]|۲۰۲[۰-۹]|202[0-9]/);
  return match ? match[0] : "";
}

function addStat(
  stats: ExtractedStat[],
  raw: string,
  context: string,
  hit: WebHit
) {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const en = toEnDigits(cleaned).replace(/,/g, "");
  if (/^(13|14|19|20)\d{2}$/.test(en)) return;
  const hasUnit =
    /تن|کیلو|میلیون|هزار|درصد|٪|متر|مگاوات|MW|میلیون تن|هزار تن/.test(
      context + " " + cleaned
    );
  if (!hasUnit && /^\d{5,}$/.test(en)) return;
  if (!hasUnit && !/(میلیون|هزار|درصد|٪)/.test(cleaned)) return;
  const kind = kindFromContext(context);
  const year = yearFromContext(context);
  const key = cleaned + "|" + year + "|" + kind + "|" + hit.url;
  if (stats.some((item) => item.raw + "|" + item.year + "|" + item.kind + "|" + item.sourceUrl === key)) {
    return;
  }
  stats.push({
    raw: cleaned,
    year,
    kind,
    sourceTitle: hit.title,
    sourceUrl: hit.url,
  });
}

export function extractStatsFromHits(hits: WebHit[]): ExtractedStat[] {
  const stats: ExtractedStat[] = [];
  const patterns: RegExp[] = [
    /[0-9۰-۹]{1,3}(?:[٬،,][0-9۰-۹]{3}){1,3}/g,
    /[0-9۰-۹]+(?:[./][0-9۰-۹]+)?\s*میلیون(?:\s*و\s*[0-9۰-۹]+\s*هزار)?/g,
    /[0-9۰-۹]+\s*میلیون\s*و\s*[0-9۰-۹]+\s*هزار/g,
    /[0-9۰-۹]+(?:[./][0-9۰-۹]+)?\s*هزار(?:\s*تن)?/g,
    /[0-9۰-۹]+(?:[./][0-9۰-۹]+)?\s*(٪|درصد)/g,
  ];

  for (const hit of hits) {
    const text = (hit.title + " " + hit.snippet).replace(/\s+/g, " ");
    for (const re of patterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const start = Math.max(0, match.index - 80);
        const end = Math.min(text.length, match.index + match[0].length + 80);
        addStat(stats, match[0], text.slice(start, end), hit);
      }
    }
  }
  return stats;
}

function kindLabel(kind: ExtractedStat["kind"]) {
  if (kind === "actual") return "مقدار واقعی";
  if (kind === "capacity") return "ظرفیت اسمی";
  if (kind === "plan") return "برنامه/پیش‌بینی";
  if (kind === "estimate") return "برآورد";
  return "نامشخص";
}

export function formatSearchContext(hits: WebHit[]) {
  const stats = extractStatsFromHits(hits);
  if (!hits.length) return "";
  const extracted = stats.length
    ? [
        "اعداد استخراج‌شده از اسنیپت‌ها. اگر این فهرست خالی نیست، حق نداری بگویی یافت نشد.",
        ...stats.map((item, i) => {
          const year = item.year || "سال نامشخص در اسنیپت";
          const src = item.sourceUrl || item.sourceTitle;
          return (
            i +
            1 +
            ") " +
            item.raw +
            " | " +
            year +
            " | " +
            kindLabel(item.kind) +
            " | منبع: " +
            src
          );
        }),
      ].join("\n")
    : "";
  return [
    "نتایج جستجوی وب برای یک سؤال آماری/واقعیتی.",
    "اولویت منبع: ۱) گزارش رسمی سازمان/شرکت ۲) سامانه‌های رسمی مثل کدال، بانک مرکزی، مرکز آمار ۳) خبرگزاری و رسانه معتبر ۴) منابع عمومی‌تر.",
    "نوع داده را قاطی نکن: مقدار واقعی رخ‌داده، ظرفیت اسمی، برنامه/پیش‌بینی، برآورد غیررسمی.",
    "فقط از همین نتایج عدد بیاور. رقم از حافظه ممنوع است. بدون زمان جواب نده.",
    "اگر مقدار واقعی پیدا شد همان را رقم اصلی بگو. ظرفیت را فقط اگر تولید واقعی نبود یا برای مقایسه کنارش بیاور.",
    extracted,
    ...hits.map((hit, i) => {
      const n = i + 1;
      const url = hit.url ? "\nمنبع: " + hit.url : "";
      return n + ". " + hit.title + url + "\n" + hit.snippet;
    }),
  ].join("\n\n");
}

export const SEARCH_DISABLED_MESSAGE = [
  "ابزار جستجوی وب خطا داد یا در حساب AvalAI فعال نیست.",
  "برای آمار رسمی، serper-search یا tavily-search یا perplexity-search یا مدل sonar را در AvalAI فعال کنید و دوباره بپرسید.",
].join("\n");

export const SEARCH_EMPTY_MESSAGE =
  "جستجوی وب انجام شد، اما در نتایج منبع معتبر، داده قطعی با زمان برای این مورد یافت نشد. رقم ساخته نمی‌شود.";

function okSearch(hits: WebHit[], note?: string): WebSearchResult {
  noteSearchUsed();
  return {
    ok: true,
    hits: hits.slice(0, 10),
    stats: extractStatsFromHits(hits),
    note,
  };
}

export async function searchWeb(
  apiKey: string,
  question: string
): Promise<WebSearchResult> {
  const queries = buildSearchQueries(question);
  if (!queries.length) {
    return { ok: false, disabled: false, error: "سؤال خالی است." };
  }

  let anyDisabled = false;
  let lastError = "";
  const gathered: WebHit[][] = [];

  for (const tool of SEARCH_TOOLS) {
    const perQuery = await Promise.all(
      queries.map((query) => searchWithTool(apiKey, query, tool))
    );
    const hits = mergeHits(
      perQuery.map((item) => item.hits.filter((hit) => !looksRefusalHit(hit)))
    );
    if (hits.length) {
      gathered.push(hits);
      const merged = mergeHits(gathered);
      const stats = extractStatsFromHits(merged);
      if (stats.length || merged.length >= 2) {
        return okSearch(merged, tool);
      }
    }
    if (perQuery.some((item) => item.disabled)) {
      anyDisabled = true;
      lastError = perQuery.find((item) => item.error)?.error || lastError;
    }
  }

  const merged = mergeHits(gathered);
  if (merged.length) {
    return okSearch(merged);
  }

  for (const model of [
    process.env.AVALAI_SEARCH_MODEL || "sonar",
    "gpt-4o-search-preview",
  ]) {
    const grounded = await searchWithGroundedModel(apiKey, queries[0], model);
    if (grounded.hits.length && !looksRefusalHit(grounded.hits[0])) {
      return okSearch(mergeHits([merged, grounded.hits]), model);
    }
    if (grounded.disabled) {
      anyDisabled = true;
      lastError = grounded.error || lastError;
    }
  }

  if (anyDisabled) {
    return {
      ok: false,
      disabled: true,
      error: lastError ? lastError + "\n" + SEARCH_DISABLED_MESSAGE : SEARCH_DISABLED_MESSAGE,
    };
  }
  return { ok: false, disabled: false, error: SEARCH_EMPTY_MESSAGE };
}
