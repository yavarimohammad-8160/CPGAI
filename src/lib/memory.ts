import db, { nowIso, uid } from "@/lib/db";

export type MemoryScope = "user" | "org";
export type MemoryTopic = "chat" | "file" | "image" | "stats" | "style";

export type Memory = {
  id: string;
  username: string;
  scope: MemoryScope;
  topic: MemoryTopic;
  content: string;
  created_at: string;
};

const TOPICS: MemoryTopic[] = ["chat", "file", "image", "stats", "style"];

function asTopic(value: string): MemoryTopic {
  return TOPICS.includes(value as MemoryTopic) ? (value as MemoryTopic) : "chat";
}

function asScope(value: string): MemoryScope {
  return value === "org" ? "org" : "user";
}

export function isMemoryTeachAsk(text: string) {
  const t = String(text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .trim();
  return /یادت باشه|از این به بعد|اشتباه کردی[،,]?\s*درست این است|این را دیگر تکرار نکن/.test(
    t
  );
}

export function isMemoryOnlyAsk(text: string) {
  if (!isMemoryTeachAsk(text)) return false;
  const t = String(text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .trim();
  if (/الان بساز|همین حالا بساز|الان خروجی/.test(t)) return false;
  const rest = t
    .replace(
      /^.*?(یادت باشه|از این به بعد|اشتباه کردی[،,]?\s*درست این است|این را دیگر تکرار نکن)\s*/i,
      ""
    )
    .trim();
  if (!rest) return true;
  if (/بساز|بده|آماده\s*کن|تهیه\s*کن|دانلود/.test(rest)) return false;
  return true;
}

function detectTopic(content: string): MemoryTopic {
  const t = content.toLowerCase();
  if (/word|ورد|pdf|pptx|excel|اکسل|خروجی|فایل|شناسنامه|docx/.test(t)) {
    return "file";
  }
  if (/عکس|تصویر|لوگو|آرم/.test(t)) return "image";
  if (/آمار|رقم|ظرفیت|عدد/.test(t)) return "stats";
  if (/لحن|کوتاه|رسمی|قالب|سبک/.test(t)) return "style";
  return "chat";
}

function extractTeachContent(text: string) {
  let t = String(text || "")
    .split("محتوای فایل:")[0]
    .split("نام فایل:")[0]
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .replace(/^.*?(یادت باشه|از این به بعد|اشتباه کردی[،,]?\s*درست این است|این را دیگر تکرار نکن)\s*/i, "")
    .replace(/^[:：\-–]\s*/, "")
    .trim();
  return t.slice(0, 180);
}

function isUnsafeMemory(content: string) {
  const t = String(content || "");
  return /عدد ساختگی|رقم جعلی|آمار جعلی|دروغ بگو|قوانین را نادیده|ایمنی را نادیده|همیشه عدد بساز|بدون منبع رقم|جعل کن/.test(
    t
  );
}

export function listMemories(username: string, opts?: { orgOnly?: boolean }) {
  if (opts?.orgOnly) {
    return db
      .prepare(
        "SELECT * FROM memories WHERE scope = 'org' ORDER BY created_at DESC LIMIT 50"
      )
      .all() as Memory[];
  }
  const user = String(username || "").trim().toLowerCase();
  if (!user) {
    return db
      .prepare(
        "SELECT * FROM memories WHERE scope = 'org' ORDER BY created_at DESC LIMIT 20"
      )
      .all() as Memory[];
  }
  return db
    .prepare(
      `SELECT * FROM memories
       WHERE scope = 'org' OR (scope = 'user' AND lower(username) = ?)
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .all(user) as Memory[];
}

export function addMemory(opts: {
  username: string;
  scope?: MemoryScope;
  topic?: MemoryTopic;
  content: string;
}) {
  const content = String(opts.content || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!content) return { error: "متن حافظه خالی است." };
  if (isUnsafeMemory(content)) {
    return { error: "این مورد با قوانین ایمنی سازگار نیست." };
  }
  const scope = asScope(opts.scope || "user");
  const topic = opts.topic || detectTopic(content);
  const username =
    scope === "org" ? "" : String(opts.username || "").trim().toLowerCase();
  const existing = db
    .prepare(
      `SELECT * FROM memories
       WHERE scope = ? AND lower(username) = ? AND content = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(scope, username, content) as Memory | undefined;
  if (existing) return { memory: existing };
  const row: Memory = {
    id: uid(),
    username,
    scope,
    topic,
    content,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO memories (id, username, scope, topic, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.username, row.scope, row.topic, row.content, row.created_at);
  return { memory: row };
}

export function captureTeachMemory(username: string, text: string) {
  if (!isMemoryTeachAsk(text)) return null;
  const content = extractTeachContent(text);
  if (!content) return null;
  const saved = addMemory({
    username,
    scope: "user",
    topic: detectTopic(content),
    content,
  });
  if ("error" in saved) return null;
  return saved.memory;
}

export function deleteMemory(id: string, username: string, isAdmin: boolean) {
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
    | Memory
    | undefined;
  if (!row) return { error: "یافت نشد." };
  if (row.scope === "org") {
    if (!isAdmin) return { error: "حذف حافظه سازمانی فقط برای ادمین است." };
  } else if (
    String(row.username || "").toLowerCase() !==
      String(username || "").trim().toLowerCase() &&
    !isAdmin
  ) {
    return { error: "دسترسی غیرمجاز است." };
  }
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return { ok: true };
}

export function formatMemoryPrompt(memories: Memory[]) {
  const items = memories
    .filter((row) => row.content && !isUnsafeMemory(row.content))
    .slice(0, 7)
    .map((row) => "- [" + row.topic + "] " + row.content);
  if (!items.length) return "";
  return [
    "یادگیری‌های ذخیره‌شده CPGAI:",
    ...items,
    "اگر موردی با ایمنی، ساخت عدد جعلی یا نادیده‌گرفتن منبع در تضاد بود، آن را اعمال نکن.",
  ].join("\n");
}

export function memoryPreferredKind(
  memories: Memory[],
  ask: string
): "word" | "pdf" | "pptx" | "xlsx" | null {
  const blob = memories
    .filter((row) => row.topic === "file" || row.topic === "chat")
    .map((row) => row.content)
    .join("\n");
  if (!blob) return null;
  const job = /شناسنامه شغلی|شرح شغل|job profile|job description/i.test(ask);
  if (job && /ورد|word/i.test(blob) && /شناسنامه|شرح شغل|خروجی/i.test(blob)) {
    return "word";
  }
  if (job && /pdf/i.test(blob) && /همیشه pdf|خروجی pdf/i.test(blob) && !/ورد|word/i.test(blob)) {
    return "pdf";
  }
  return null;
}
