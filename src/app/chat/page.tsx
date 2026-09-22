"use client";
import MessageActions from "./MessageActions";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { InstallAppButton } from "@/components/install-app";
import { ChatRichText } from "@/components/chat-rich-text";
import { isImageEditAsk, isImageWorkAsk } from "@/lib/image-work";

type PendingFile = {
  name: string;
  type: string;
  text: string;
  note: string;
  weak: boolean;
  limited: boolean;
};

type AttachStatus = "preparing" | "reading" | "ready" | "error";

type AttachItem = {
  id: string;
  kind: "file" | "image";
  name: string;
  size: number;
  type: string;
  status: AttachStatus;
  slow: boolean;
  error?: string;
  preview?: string;
  pending?: PendingFile;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  id?: string;
  feedback?: "up" | "down" | null;
  feedbackNote?: string;
  feedbackAskAgain?: boolean;
  feedbackPanel?: boolean;
  streaming?: boolean;
  streamingStatus?: "think" | "search";
  image?: string;
  images?: string[];
  files?: Array<{ name?: string; type?: string; text?: string }>;
  fileName?: string;
  filename?: string;
  fileUrl?: string;
  url?: string;
  fileBase64?: string;
  fileMime?: string;
  file?: { url?: string; name?: string; mime?: string };
  attachedName?: string;
  attachedStatus?: string;
  sourceText?: string;
};

type Conversation = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  messages: Message[];
};

type ComposerDraft = {
  input: string;
  image: string;
  images: string[];
  files: PendingFile[];
  attachItems?: AttachItem[];
  fileName: string;
  fileText: string;
  fileNote: string;
  fileWeak: boolean;
  fileLimited: boolean;
};

function emptyDraft(): ComposerDraft {
  return {
    input: "",
    image: "",
    images: [],
    files: [],
    attachItems: [],
    fileName: "",
    fileText: "",
    fileNote: "",
    fileWeak: false,
    fileLimited: false,
  };
}

const MAX_IMAGES = 5;

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start: () => void;
  stop: () => void;
};

const EDIT_KEYS = [
  "ویرایش",
  "پس زمینه",
  "پس‌زمینه",
  "بک‌گراند",
  "بک گراند",
  "عوض کن",
  "تغییر بده",
  "همین عکس",
  "این عکس را",
  "این عکس رو",
];

const GENERATE_KEYS = [
  "درست کن",
  "بساز",
  "بکش",
  "طراحی کن",
  "عکس بده",
  "تصویر بده",
  "یه عکس",
  "یک عکس",
];

const FILE_ACCEPT = [
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.json,.log,.rtf,.psd",
  ".png,.jpg,.jpeg,.webp",
  "application/pdf,application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain,text/csv,text/markdown,application/json,application/rtf,text/rtf",
  "image/png,image/jpeg,image/webp,image/vnd.adobe.photoshop",
].join(",");

const LIMITED_EXTRACT_NOTE =
  "این فرمت برای استخراج متن پشتیبانی محدود دارد";
const WEAK_EXTRACT_NOTE = "بخشی از متن فایل خوانا نبود";
const READ_OK_NOTE = "فایل خوانده شد";
const SLOW_READ_NOTE = "خواندن فایل طول کشیده؛ لطفاً صبر کنید";

function attachId() {
  return (
    "att-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function formatFileSize(bytes: number) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n < 1024) return n.toLocaleString("fa-IR") + " بایت";
  if (n < 1024 * 1024) {
    return (n / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " کیلوبایت";
  }
  return (n / (1024 * 1024)).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " مگابایت";
}

function attachStatusText(item: AttachItem) {
  if (item.status === "error") return item.error || "خواندن فایل ناموفق بود.";
  if (item.status === "ready") return "آماده ارسال";
  if (item.slow) return SLOW_READ_NOTE;
  if (item.status === "reading") return "در حال خواندن فایل...";
  return "در حال آماده‌سازی";
}

function logFileStatus(name: string, status: string) {
  console.log("FILE_STATUS", name, status);
}

function looksLikeSearchAsk(text: string) {
  return /آمار|رقم|ظرفیت|تولید واقعی|آخرین گزارش|آخرین آمار|کدال|قیمت|نرخ|تناژ/.test(
    String(text || "")
  );
}

function stripSearchPrefix(text: string) {
  return String(text || "").replace(/^منابع عمومی بررسی شد\.?\s*/g, "");
}

function getStoredVoice() {
  return localStorage.getItem("cpgai-voice") === "on";
}
const FILE_DUMP_RE =
  /\n(?:نام فایل:|محتوای فایل:|فایل خوانده شد|متن تصویر خوانده شد|متن استخراج‌شده از تصویر:)/;

const WELCOME: Message[] = [
  {
    role: "assistant",
    content: "سلام. بپرس تا کمکت کنم.",
  },
];

function toDisplayMediaSrc(src?: string) {
  const s = String(src || "").trim().split("?")[0];
  const m = s.match(/^\/(generated|outputs)\/([^/]+)$/);
  if (m) return "/api/media/" + m[1] + "/" + m[2];
  return String(src || "").trim();
}

function isDisplayableImageSrc(src?: string) {
  const s = toDisplayMediaSrc(src);
  if (!s) return false;
  if (/\.(docx|pptx|xlsx|pdf)(\?|$)/i.test(s)) return false;
  if (s.startsWith("data:image") || s.startsWith("blob:")) return true;
  if (s.startsWith("/api/media/generated/") || s.startsWith("/generated")) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(s);
}

function fileMeta(msg: Message) {
  const nested = msg.file && typeof msg.file === "object" ? msg.file : {};
  const name = msg.fileName || msg.filename || nested.name || "";
  const url = toDisplayMediaSrc(msg.fileUrl || nested.url || msg.url || "");
  const mime = msg.fileMime || nested.mime || "";
  return { name, url, mime, base64: msg.fileBase64 || "" };
}

function messageImages(msg: Message) {
  const out: string[] = [];
  const add = (src?: string) => {
    const v = toDisplayMediaSrc(src || "");
    if (isDisplayableImageSrc(v) && !out.includes(v)) out.push(v);
  };
  add(msg.image);
  if (Array.isArray(msg.images)) {
    for (const item of msg.images) add(item);
  }
  const meta = fileMeta(msg);
  if (isDisplayableImageSrc(meta.url)) add(meta.url);
  if (
    meta.base64 &&
    (meta.mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(meta.name))
  ) {
    add("data:" + (meta.mime || "image/png") + ";base64," + meta.base64);
  }
  return out;
}

function messageImageSrc(msg: Message) {
  return messageImages(msg)[0] || "";
}

function hasFilePayload(msg: Message) {
  const meta = fileMeta(msg);
  return !!(meta.name || meta.url || meta.base64);
}

function fileKindLabel(name?: string, mime?: string) {
  const lower = (name || "").toLowerCase();
  const type = (mime || "").toLowerCase();
  if (lower.endsWith(".pdf") || type.includes("pdf")) return "PDF";
  if (lower.endsWith(".pptx") || type.includes("presentation")) return "PowerPoint";
  if (lower.endsWith(".xlsx") || type.includes("spreadsheet")) return "Excel";
  if (name?.includes("presentation-script")) return "متن ارائه";
  if (lower.endsWith(".docx") || type.includes("wordprocessing")) return "Word";
  return "فایل";
}

function fileKindShort(label: string) {
  if (label === "PowerPoint") return "PPT";
  if (label === "Excel") return "XLS";
  if (label === "متن ارائه") return "DOC";
  if (label === "Word") return "W";
  if (label === "PDF") return "PDF";
  return "FILE";
}

function blobFromMessageFile(msg: Message) {
  const meta = fileMeta(msg);
  if (meta.url && !meta.url.startsWith("data:")) return { href: meta.url, blobUrl: "" };
  const dataUrl =
    meta.base64 && meta.mime
      ? "data:" + meta.mime + ";base64," + meta.base64
      : meta.url.startsWith("data:")
        ? meta.url
        : "";
  const base64 = meta.base64 || (dataUrl.includes(",") ? dataUrl.split(",")[1] : "");
  if (!base64) return { href: meta.url || "", blobUrl: "" };
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: meta.mime || "application/octet-stream",
  });
  const blobUrl = URL.createObjectURL(blob);
  return { href: blobUrl, blobUrl };
}

function dataUrlToBlobUrl(src: string) {
  if (!src.startsWith("data:")) return src;
  const [header, data = ""] = src.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function ChatImage({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: (src: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(src);

  useEffect(() => {
    setFailed(false);
    if (src.startsWith("data:image")) {
      try {
        const blobUrl = dataUrlToBlobUrl(src);
        setDisplaySrc(blobUrl);
        return () => URL.revokeObjectURL(blobUrl);
      } catch {
        setDisplaySrc(src);
      }
      return;
    }
    setDisplaySrc(src);
  }, [src]);

  if (!src || failed) {
    return (
      <p className="mb-2 text-xs text-slate-500">نمایش تصویر ممکن نشد</p>
    );
  }

  return (
    // Regular img required so Chrome/Edge can show generated data URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={alt}
      onClick={() => onOpen(displaySrc || src)}
      onError={() => setFailed(true)}
      className="mb-2 cursor-zoom-in rounded-2xl"
      style={{ maxWidth: 320, cursor: "zoom-in" }}
    />
  );
}

function FileCard({ msg }: { msg: Message }) {
  const meta = fileMeta(msg);
  const label = fileKindLabel(meta.name, meta.mime);
  const href = useMemo(() => blobFromMessageFile(msg).href, [msg]);

  useEffect(() => {
    return () => {
      if (href.startsWith("blob:")) URL.revokeObjectURL(href);
    };
  }, [href]);

  if (!meta.name && !href) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 text-[#0f2744]">
      <div className="flex min-w-0 flex-1 items-center gap-3 text-right">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0f2744] text-[11px] font-bold text-white">
          {fileKindShort(label)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {meta.name || "فایل خروجی"}
          </span>
          <span className="block text-xs text-slate-500">{label}</span>
        </span>
      </div>
      {href ? (
        <a
          href={href}
          download={meta.name || "cpgai-output"}
          className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-sm"
        >
          دانلود
        </a>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-xl bg-[#0f2744] px-3 py-2 text-sm text-white"
        >
          مشاهده
        </a>
      ) : null}
    </div>
  );
}

function normalizeChatPayload(data: Record<string, unknown>): Partial<Message> {
  const file =
    data.file && typeof data.file === "object"
      ? (data.file as { url?: string; name?: string; mime?: string })
      : {};
  const fileName = String(data.fileName || data.filename || file.name || "");
  const fileMime = String(data.fileMime || data.mime || file.mime || "");
  const fileUrl = toDisplayMediaSrc(String(data.fileUrl || file.url || data.url || ""));
  const fileBase64 = String(data.fileBase64 || "");
  const imageRaw = toDisplayMediaSrc(String(data.image || ""));
  const image = isDisplayableImageSrc(imageRaw) ? imageRaw : "";
  let extraImages: string[] = [];
  if (Array.isArray(data.images)) {
    extraImages = data.images.map((item) => toDisplayMediaSrc(String(item || "")));
  } else if (typeof data.images === "string" && data.images.trim()) {
    try {
      const parsed = JSON.parse(data.images) as unknown;
      if (Array.isArray(parsed)) {
        extraImages = parsed.map((item) => toDisplayMediaSrc(String(item || "")));
      }
    } catch {
      extraImages = [];
    }
  }
  const images = [image, ...extraImages].filter(
    (src, i, arr) => isDisplayableImageSrc(src) && arr.indexOf(src) === i
  );
  return {
    image: images[0] || undefined,
    images: images.length ? images : undefined,
    fileName: fileName || undefined,
    fileUrl: fileUrl || undefined,
    fileMime: fileMime || undefined,
    fileBase64: fileBase64 || undefined,
    file:
      file.url || file.name
        ? { ...file, url: toDisplayMediaSrc(file.url || "") || file.url }
        : undefined,
  };
}

function isEditText(text: string) {
  return EDIT_KEYS.some((key) => text.includes(key));
}

function isGenerateText(text: string) {
  return GENERATE_KEYS.some((key) => text.includes(key));
}

function isSourceImageAsk(text: string) {
  const t = text || "";
  return /شناسنامه|شرح شغل|از روی این|متن را بخوان|متن تصویر|job profile|job description/i.test(
    t
  ) || (/خلاصه|گزارش/.test(t) && /عکس|تصویر/.test(t));
}

function findLatestImage(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const imgs = messageImages(messages[i]);
    if (imgs[0]) return imgs[0];
  }
  return undefined;
}

function getStoredUser() {
  return localStorage.getItem("cpgai-user") || "";
}

function getStoredRole() {
  return localStorage.getItem("cpgai-role") || "";
}

function getStoredName() {
  const name = (localStorage.getItem("cpgai-name") || "").trim();
  return name || getStoredUser();
}

function splitUserDisplay(content: string) {
  const raw = String(content || "");
  const idx = raw.search(FILE_DUMP_RE);
  if (idx < 0) {
    return { visible: raw, attachedName: "", attachedStatus: "" };
  }
  const visible = raw.slice(0, idx).trim();
  const rest = raw.slice(idx);
  const name = (rest.match(/نام فایل:\s*([^\n]+)/) || [])[1]?.trim() || "";
  const limited = /پشتیبانی محدود/.test(rest);
  const weak = /خوانا نبود|خوانده نشد|پشتیبانی محدود/.test(rest);
  const attachedStatus = limited
    ? LIMITED_EXTRACT_NOTE
    : weak
      ? WEAK_EXTRACT_NOTE
      : name
        ? READ_OK_NOTE
        : "";
  return { visible, attachedName: name, attachedStatus };
}

function visibleUserContent(msg: Message) {
  if (msg.role !== "user") return msg.content;
  if (msg.attachedName) return msg.content;
  return splitUserDisplay(msg.content).visible;
}

function userAttachment(msg: Message) {
  if (msg.role !== "user") return { name: "", status: "" };
  if (msg.attachedName) {
    return {
      name: msg.attachedName,
      status: msg.attachedStatus || READ_OK_NOTE,
    };
  }
  const parsed = splitUserDisplay(msg.content);
  return { name: parsed.attachedName, status: parsed.attachedStatus };
}

function apiUserContent(msg: Message) {
  if (msg.role !== "user") return msg.content;
  const fileRows = Array.isArray(msg.files) ? msg.files : [];
  if (msg.sourceText || msg.attachedName || fileRows.length) {
    const ask = (msg.content || "").trim() || "این فایل را بررسی کن.";
    const parts = [ask, ""];
    if (msg.attachedName) parts.push("نام فایل: " + msg.attachedName);
    if (msg.attachedStatus) parts.push(msg.attachedStatus);
    if (msg.sourceText) {
      parts.push("محتوای فایل:", msg.sourceText);
    } else {
      for (const row of fileRows) {
        if (row.name) parts.push("نام فایل: " + row.name);
        if (row.text) parts.push("محتوای فایل:", row.text);
      }
    }
    return parts.filter((part, i) => i < 2 || part).join("\n");
  }
  return msg.content;
}

function conversationTitle(messages: Message[]) {
  const first = messages.find((msg) => msg.role === "user");
  if (!first) return "گفتگوی جدید";
  const vis = visibleUserContent(first).replace(/\s+/g, " ").trim();
  const name = userAttachment(first).name;
  const text = vis || name;
  if (!text) return "گفتگوی جدید";
  return text.length > 40 ? text.slice(0, 40) + "…" : text;
}

function sortConversations(convos: Conversation[]) {
  return [...convos].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

type ServerConvo = {
  id: string;
  title?: string;
  pinned?: number | boolean;
  created_at?: string;
  updated_at?: string;
};

const MAX_STORE_BLOB = 350000;

function historyHeaders(user: string) {
  return {
    "Content-Type": "application/json",
    "x-cpgai-user": user,
  };
}

function mapServerConvo(row: ServerConvo, messages: Message[] = []): Conversation {
  return {
    id: String(row.id),
    title: String(row.title || "گفتگوی جدید").trim() || "گفتگوی جدید",
    pinned: !!row.pinned,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) || Date.now() : Date.now(),
    messages,
  };
}

function fromApiMessage(raw: Record<string, unknown>): Message {
  const extra = normalizeChatPayload(raw);
  const fileUrl = extra.fileUrl || "";
  let fileBase64 = extra.fileBase64;
  let fileMime = extra.fileMime;
  if (!fileBase64 && fileUrl.startsWith("data:")) {
    const [header, data = ""] = fileUrl.split(",");
    fileMime = header.match(/data:(.*?);base64/)?.[1] || fileMime;
    fileBase64 = data || undefined;
  }
  return {
    role: raw.role === "assistant" ? "assistant" : "user",
    content: String(raw.content || ""),
    image: extra.image,
    images: extra.images,
    fileName: extra.fileName,
    fileUrl: fileUrl || undefined,
    fileBase64,
    fileMime,
    file: extra.file,
  };
}

function toApiMessages(messages: Message[]) {
  return messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      const content =
        msg.role === "user" ? apiUserContent(msg) : msg.content || "";
      const row: {
        role: string;
        content: string;
        image: string;
        images: string[];
        fileName: string;
        fileUrl: string;
      } = {
        role: msg.role,
        content,
        image: "",
        images: [],
        fileName: msg.fileName || msg.attachedName || "",
        fileUrl: "",
      };
      try {
        const imgs = messageImages(msg);
        row.images = imgs.filter(
          (img) =>
            img.startsWith("/api/media/") ||
            img.startsWith("/generated") ||
            img.startsWith("/outputs") ||
            img.startsWith("http://") ||
            img.startsWith("https://") ||
            img.startsWith("data:image") ||
            (img && img.length <= MAX_STORE_BLOB)
        );
        row.image = row.images[0] || "";
        const fileUrl = toDisplayMediaSrc(
          msg.fileUrl ||
            msg.file?.url ||
            (msg.fileBase64
              ? "data:" +
                (msg.fileMime || "application/octet-stream") +
                ";base64," +
                msg.fileBase64
              : "")
        );
        if (
          fileUrl.startsWith("/api/media/") ||
          fileUrl.startsWith("/generated") ||
          fileUrl.startsWith("/outputs") ||
          fileUrl.startsWith("http://") ||
          fileUrl.startsWith("https://") ||
          fileUrl.startsWith("data:")
        ) {
          row.fileUrl = fileUrl;
        } else if (fileUrl && fileUrl.length <= MAX_STORE_BLOB) {
          row.fileUrl = fileUrl;
        }
      } catch {
        // keep text even if media is too large
      }
      return row;
    });
}

async function loadConversations(user: string): Promise<Conversation[]> {
  const res = await fetch("/api/history", { headers: historyHeaders(user) });
  const data = await res.json();
  const list = Array.isArray(data.conversations) ? data.conversations : [];
  return sortConversations(list.map((row: ServerConvo) => mapServerConvo(row)));
}

async function loadConversation(user: string, id: string) {
  const res = await fetch("/api/history?id=" + encodeURIComponent(id), {
    headers: historyHeaders(user),
  });
  const data = await res.json();
  const messages = Array.isArray(data.messages)
    ? data.messages.map(fromApiMessage)
    : [];
  const convo = data.conversation
    ? mapServerConvo(data.conversation as ServerConvo, messages)
    : null;
  return { convo, messages };
}

async function createConversation(user: string) {
  const res = await fetch("/api/history", {
    method: "POST",
    headers: historyHeaders(user),
    body: JSON.stringify({ username: user, title: "گفتگوی جدید" }),
  });
  return res.json() as Promise<{ id: string; title: string }>;
}

function keepLocalMessages(prev: Conversation[], incoming: Conversation[]) {
  return incoming.map((item) => {
    const old = prev.find((row) => row.id === item.id);
    const nextCount = item.messages?.length || 0;
    const oldCount = old?.messages?.length || 0;
    if (old && oldCount > 0 && oldCount >= nextCount) {
      return { ...item, messages: old.messages, title: item.title || old.title };
    }
    return item;
  });
}

async function saveConversation(
  user: string,
  conversationId: string,
  messages: Message[],
  title?: string
) {
  if (!conversationId) return;
  if (!messages.length) {
    console.log("HIST_SKIP_EMPTY", { id: conversationId, count: 0 });
    return;
  }
  console.log("HIST_SAVE", { id: conversationId, count: messages.length });
  try {
    await fetch("/api/history", {
      method: "PUT",
      headers: historyHeaders(user),
      body: JSON.stringify({
        username: user,
        conversationId,
        title,
        messages: toApiMessages(messages),
      }),
    });
  } catch {
    // history save must not break chat
  }
}

function IconDots() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="4" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="10" cy="16" r="1.6" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M13.6 2.9a1.5 1.5 0 0 1 2.1 0l1.4 1.4a1.5 1.5 0 0 1 0 2.1L7.4 15.9 3 17l1.1-4.4L13.6 2.9Zm1.1 1.1-1.1-1.1-2 2 1.1 1.1 2-2Zm-2.7 2.7L4.8 13.9l-.5 1.8 1.8-.5 7.2-7.2-1.3-1.3Z" />
    </svg>
  );
}

function IconPin({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      {filled ? (
        <path d="M10.8 2.4 17.6 9.2a1 1 0 0 1 0 1.4l-1.1 1.1-3.1-.6-3.3 3.3v3.1L8.7 16l-2-2-3.4 3.4-.7-.7 3.4-3.4-2-2 1.5-1.4h3.1l3.3-3.3-.6-3.1 1.1-1.1a1 1 0 0 1 1.4 0Z" />
      ) : (
        <path d="M11.1 3.1 16.9 8.9a.8.8 0 0 1 0 1.1l-1.2 1.2-2.8-.5-3 3v2.6l-1.2 1.2-1.7-1.7-3.1 3.1-.9-.9 3.1-3.1-1.7-1.7 1.2-1.2h2.6l3-3-.5-2.8 1.2-1.2a.8.8 0 0 1 1.1 0Zm.2 1.7.3 1.8-3.4 3.4H6.6l2.2 2.2.1 1.3 3.4-3.4 1.8.3.4-.4-6.2-6.2Z" />
      )}
    </svg>
  );
}

function readChatQueryId() {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("id") || "";
  } catch {
    return "";
  }
}

export default function ChatPage() {
  const router = useRouter();
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const draftsRef = useRef<Record<string, ComposerDraft>>({});
  const conversationIdRef = useRef("");
  const snapshotRef = useRef<ComposerDraft>(emptyDraft());
  const streamRafRef = useRef<Record<string, number>>({});
  const abortRef = useRef<Record<string, AbortController>>({});
  const pendingIdsRef = useRef<Record<string, true>>({});
  const saveTimersRef = useRef<Record<string, number>>({});
  const lastSavedSigRef = useRef<Record<string, string>>({});
  const loadGenRef = useRef<Record<string, number>>({});
  const openChatRef = useRef<(id: string) => Promise<void>>(async () => {});

  const username = useSyncExternalStore(
    () => () => {},
    getStoredUser,
    () => ""
  );
  const role = useSyncExternalStore(
    () => () => {},
    getStoredRole,
    () => ""
  );
  const displayName = useSyncExternalStore(
    () => () => {},
    getStoredName,
    () => ""
  );
  const voiceOn = useSyncExternalStore(
    () => () => {},
    getStoredVoice,
    () => false
  );
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [pendingIds, setPendingIds] = useState<Record<string, true>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [attachItems, setAttachItems] = useState<AttachItem[]>([]);
  const attachItemsRef = useRef<AttachItem[]>([]);
  const [listening, setListening] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quotaLine, setQuotaLine] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [actionMenuId, setActionMenuId] = useState("");
  const [actionMenuPos, setActionMenuPos] = useState({ top: 0, right: 0 });

  conversationIdRef.current = conversationId;
  pendingIdsRef.current = pendingIds;
  snapshotRef.current = {
    input,
    image: images[0] || "",
    images,
    files,
    attachItems,
    fileName: files[0]?.name || "",
    fileText: files.map((row) => row.text).filter(Boolean).join("\n\n"),
    fileNote: files[0]?.note || "",
    fileWeak: !!files[0]?.weak,
    fileLimited: !!files[0]?.limited,
  };

  const active =
    conversations.find((convo) => convo.id === conversationId) ||
    conversations[0];
  const messages = active?.messages?.length
    ? active.messages
    : active && active.title === "گفتگوی جدید" && !pendingIds[active.id]
      ? WELCOME
      : active?.messages || [];
  attachItemsRef.current = attachItems;
  const fileBusy = attachItems.some(
    (item) => item.status === "preparing" || item.status === "reading"
  );
  const loading = !!conversationId && !!pendingIds[conversationId];

  async function loadQuota() {
    if (!username) return;
    try {
      const res = await fetch("/api/quota", {
        headers: { "x-cpgai-user": username },
      });
      const data = await res.json();
      if (!res.ok) return;
      setQuotaLine(typeof data.line === "string" ? data.line : "");
    } catch {
      /* optional */
    }
  }

  useEffect(() => {
    if (!username) {
      router.replace("/");
      return;
    }
    void loadQuota();

    let cancelled = false;
    async function boot() {
      setReady(false);
      try {
        let list = await loadConversations(username);
        if (cancelled) return;
        if (!list.length) {
          await createConversation(username);
          if (cancelled) return;
          list = await loadConversations(username);
        }
        const wanted = readChatQueryId();
        const first =
          list.find((item) => item.id === wanted) || list[0];
        if (!first) return;
        const full = await loadConversation(username, first.id);
        if (cancelled) return;
        setConversations(
          list.map((item) =>
            item.id === first.id && full.convo ? full.convo : item
          )
        );
        setConversationId(first.id);
        syncChatUrl(first.id);
      } catch {
        if (cancelled) return;
        try {
          const created = await createConversation(username);
          if (cancelled) return;
          setConversations([
            {
              id: created.id,
              title: created.title || "گفتگوی جدید",
              pinned: false,
              updatedAt: Date.now(),
              messages: [],
            },
          ]);
          setConversationId(created.id);
          syncChatUrl(created.id);
        } catch {
          // ignore
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [username, router]);

  useEffect(() => {
    if (!username || !ready) return;
    for (const convo of conversations) {
      const msgs = convo.messages || [];
      if (!msgs.length) {
        if (lastSavedSigRef.current[convo.id] !== "empty") {
          lastSavedSigRef.current[convo.id] = "empty";
          console.log("HIST_SKIP_EMPTY", { id: convo.id, count: 0 });
        }
        continue;
      }
      const last = msgs[msgs.length - 1];
      const sig =
        msgs.length +
        ":" +
        (last?.content?.length || 0) +
        ":" +
        (last?.fileUrl || "") +
        ":" +
        (last?.streaming ? "s" : "d");
      if (lastSavedSigRef.current[convo.id] === sig) continue;
      window.clearTimeout(saveTimersRef.current[convo.id]);
      const id = convo.id;
      const title =
        convo.title && convo.title !== "گفتگوی جدید" ? convo.title : undefined;
      const snapshot = msgs;
      saveTimersRef.current[id] = window.setTimeout(() => {
        if (!snapshot.length) {
          console.log("HIST_SKIP_EMPTY", { id, count: 0 });
          return;
        }
        lastSavedSigRef.current[id] = sig;
        void saveConversation(username, id, snapshot, title);
      }, 400);
    }
  }, [conversations, username, ready]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    if (!menuOpen) return;

    function onDocClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  useEffect(() => {
    if (editingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!actionMenuId && !editingId) return;

    function onDocClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-convo-menu]")) return;
      if (target?.closest("[data-rename-input]")) return;
      setActionMenuId("");
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editingId) {
        setEditingId("");
        setDraftTitle("");
      }
      setActionMenuId("");
    }

    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [actionMenuId, editingId]);

  useEffect(() => {
    function onPop() {
      const wanted = readChatQueryId();
      if (!wanted || wanted === conversationIdRef.current) return;
      void openChatRef.current(wanted);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!lightboxSrc) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxSrc(null);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [lightboxSrc]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 192) + "px";
  }, [input]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recRef.current?.stop();
      Object.values(abortRef.current).forEach((ac) => ac.abort());
      Object.values(saveTimersRef.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  function logout() {
    localStorage.removeItem("cpgai-user");
    localStorage.removeItem("cpgai-role");
    localStorage.removeItem("cpgai-name");
    router.replace("/");
  }

  function syncChatUrl(id: string) {
    try {
      router.replace("/chat?id=" + encodeURIComponent(id), { scroll: false });
    } catch {
      // ignore
    }
  }

  function applyDraft(id: string) {
    const draft = draftsRef.current[id] || emptyDraft();
    setInput(draft.input);
    setImages(
      draft.images?.length
        ? draft.images
        : draft.image
          ? [draft.image]
          : []
    );
    setFiles(Array.isArray(draft.files) ? draft.files : []);
    setAttachItems(
      Array.isArray(draft.attachItems) && draft.attachItems.length
        ? draft.attachItems
        : itemsFromDraft(draft)
    );
  }

  async function openChat(id: string) {
    if (!username || !id) return;
    if (id === conversationId && (active?.messages?.length || 0) > 0) {
      setMenuOpen(false);
      setActionMenuId("");
      setSidebarOpen(false);
      syncChatUrl(id);
      return;
    }
    if (conversationId) draftsRef.current[conversationId] = snapshotRef.current;
    const req = (loadGenRef.current[id] || 0) + 1;
    loadGenRef.current[id] = req;
    setConversationId(id);
    applyDraft(id);
    syncChatUrl(id);
    setMenuOpen(false);
    setActionMenuId("");
    setSidebarOpen(false);

    if (pendingIdsRef.current[id]) {
      return;
    }

    try {
      const full = await loadConversation(username, id);
      if (loadGenRef.current[id] !== req) return;
      setConversations((prev) => {
        if (pendingIdsRef.current[id]) {
          const local = prev.find((item) => item.id === id);
          if ((local?.messages?.length || 0) >= (full.messages?.length || 0)) {
            return prev;
          }
        }
        const loaded =
          full.convo ||
          mapServerConvo({ id, title: "گفتگوی جدید" }, full.messages);
        const exists = prev.some((item) => item.id === id);
        const next = exists
          ? prev.map((item) => (item.id === id ? loaded : item))
          : [loaded, ...prev];
        return sortConversations(keepLocalMessages(prev, next));
      });
    } catch {
      /* keep local */
    }
  }
  openChatRef.current = openChat;

  async function newChat() {
    if (!username) return;
    if (conversationId) draftsRef.current[conversationId] = snapshotRef.current;
    const created = await createConversation(username);
    const list = await loadConversations(username);
    setConversations((prev) =>
      keepLocalMessages(
        prev,
        list.map((item) =>
          item.id === created.id ? { ...item, messages: [] } : item
        )
      )
    );
    setConversationId(created.id);
    applyDraft(created.id);
    syncChatUrl(created.id);
    setMenuOpen(false);
    setActionMenuId("");
    setSidebarOpen(false);
  }

  async function deleteChat(id: string) {
    if (!username || !id) return;
    setActionMenuId("");
    setEditingId("");
    delete draftsRef.current[id];
    await fetch("/api/history?id=" + encodeURIComponent(id), {
      method: "DELETE",
      headers: historyHeaders(username),
    });
    let list = await loadConversations(username);
    if (!list.length) {
      const created = await createConversation(username);
      list = await loadConversations(username);
      setConversations((prev) => keepLocalMessages(prev, list));
      setConversationId(created.id);
      applyDraft(created.id);
      syncChatUrl(created.id);
      return;
    }
    setConversations((prev) => keepLocalMessages(prev, list));
    if (conversationId === id) {
      await openChat(list[0].id);
    }
  }

  function startRename(id: string, currentTitle: string) {
    setActionMenuId("");
    setEditingId(id);
    setDraftTitle(currentTitle);
  }

  function cancelRename() {
    setEditingId("");
    setDraftTitle("");
  }

  async function renameChat(id: string, title: string) {
    const nextTitle = title.trim();
    if (!username || !id || !nextTitle) return;
    setConversations((prev) =>
      prev.map((convo) => (convo.id === id ? { ...convo, title: nextTitle } : convo))
    );
    await fetch("/api/history", {
      method: "PUT",
      headers: historyHeaders(username),
      body: JSON.stringify({
        username,
        conversationId: id,
        title: nextTitle.slice(0, 80),
      }),
    });
  }

  function commitRename(id: string) {
    if (editingId !== id) return;
    const title = draftTitle.trim();
    if (!title) return;
    void renameChat(id, title);
    setEditingId("");
    setDraftTitle("");
  }

  async function pinChat(id: string) {
    if (!username || !id) return;
    const current = conversations.find((item) => item.id === id);
    const pinned = !current?.pinned;
    setConversations((prev) =>
      sortConversations(
        prev.map((convo) =>
          convo.id === id ? { ...convo, pinned } : convo
        )
      )
    );
    setActionMenuId("");
    await fetch("/api/history", {
      method: "PUT",
      headers: historyHeaders(username),
      body: JSON.stringify({
        username,
        conversationId: id,
        pinned,
      }),
    });
  }

  function openInNewTab(id: string) {
    setActionMenuId("");
    window.open(
      "/chat?id=" + encodeURIComponent(id),
      "_blank",
      "noopener,noreferrer"
    );
  }

  function openActionMenu(
    id: string,
    event: ReactMouseEvent<HTMLButtonElement>
  ) {
    event.stopPropagation();
    if (actionMenuId === id) {
      setActionMenuId("");
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuHeight = 188;
    const top =
      window.innerHeight - rect.bottom < menuHeight + 12
        ? Math.max(8, rect.top - menuHeight)
        : rect.bottom + 6;
    setActionMenuPos({
      top,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setActionMenuId(id);
  }

  function patchConversation(id: string, nextMessages: Message[]) {
    setConversations((prev) =>
      sortConversations(
        prev.map((convo) => {
          if (convo.id !== id) return convo;
          const title =
            convo.title === "گفتگوی جدید"
              ? conversationTitle(nextMessages)
              : convo.title;
          return {
            ...convo,
            title,
            updatedAt: Date.now(),
            messages: nextMessages,
          };
        })
      )
    );
  }

  function patchStreamText(
    id: string,
    text: string,
    done = false,
    status?: "think" | "search"
  ) {
    setConversations((prev) =>
      prev.map((convo) => {
        if (convo.id !== id) return convo;
        const msgs = convo.messages.slice();
        const last = msgs[msgs.length - 1];
        const clean = stripSearchPrefix(text);
        if (last?.role === "assistant") {
          msgs[msgs.length - 1] = {
            ...last,
            content: clean,
            streaming: done ? undefined : true,
            streamingStatus: done
              ? undefined
              : status || last.streamingStatus || "think",
          };
        } else {
          msgs.push({
            role: "assistant",
            content: clean,
            streaming: done ? undefined : true,
            streamingStatus: done ? undefined : status || "think",
          });
        }
        return { ...convo, messages: msgs };
      })
    );
  }

  function itemsFromDraft(draft: ComposerDraft): AttachItem[] {
    const imgs = draft.images?.length
      ? draft.images
      : draft.image
        ? [draft.image]
        : [];
    const fromImgs: AttachItem[] = imgs.map((src, i) => ({
      id: "draft-img-" + i,
      kind: "image",
      name: "تصویر",
      size: 0,
      type: "image/jpeg",
      status: "ready",
      slow: false,
      preview: src,
    }));
    const fromFiles: AttachItem[] = (draft.files || []).map((row, i) => ({
      id: "draft-file-" + i,
      kind: "file",
      name: row.name,
      size: 0,
      type: row.type,
      status: "ready",
      slow: false,
      pending: row,
    }));
    return [...fromImgs, ...fromFiles];
  }

  function patchAttach(id: string, patch: Partial<AttachItem>) {
    let found = false;
    setAttachItems((prev) => {
      found = prev.some((item) => item.id === id);
      if (!found) return prev;
      return prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
    });
    return found;
  }

  function stillHasAttach(id: string) {
    return attachItemsRef.current.some((item) => item.id === id);
  }

  function startSlowTimer(id: string, name: string) {
    return window.setTimeout(() => {
      if (!stillHasAttach(id)) return;
      const current = attachItemsRef.current.find((item) => item.id === id);
      if (!current || current.status === "ready" || current.status === "error") {
        return;
      }
      patchAttach(id, { slow: true });
      logFileStatus(name, "waiting");
    }, 30000);
  }

  function removeAttach(id: string) {
    const item = attachItemsRef.current.find((row) => row.id === id);
    setAttachItems((prev) => prev.filter((row) => row.id !== id));
    if (item?.kind === "image" && item.preview) {
      setImages((prev) => prev.filter((src) => src !== item.preview));
    }
    if (item?.kind === "file" && item.pending) {
      setFiles((prev) => prev.filter((row) => row !== item.pending));
    } else if (item?.kind === "file") {
      setFiles((prev) => prev.filter((row) => row.name !== item.name));
    }
  }

  function compressImageFile(file: File) {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 1024;
        const scale = Math.min(max / img.width, max / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("خواندن تصویر ممکن نشد"));
      };
      img.src = url;
    });
  }

  async function addCompressedImages(picked: File[]) {
    if (!picked.length) return;
    const currentCount = attachItemsRef.current.filter(
      (item) => item.kind === "image"
    ).length;
    const room = Math.max(0, MAX_IMAGES - currentCount);
    const take = picked.slice(0, room || MAX_IMAGES);
    if (!take.length) return;
    const created: AttachItem[] = take.map((file) => ({
      id: attachId(),
      kind: "image",
      name: file.name || "تصویر",
      size: file.size,
      type: file.type || "image/jpeg",
      status: "preparing",
      slow: false,
    }));
    setAttachItems((prev) => [...prev, ...created]);
    for (const item of created) logFileStatus(item.name, "preparing");

    for (let i = 0; i < take.length; i += 1) {
      const file = take[i];
      const item = created[i];
      const timer = startSlowTimer(item.id, item.name);
      try {
        patchAttach(item.id, { status: "reading" });
        logFileStatus(item.name, "reading");
        const dataUrl = await compressImageFile(file);
        window.clearTimeout(timer);
        if (!stillHasAttach(item.id)) continue;
        patchAttach(item.id, {
          status: "ready",
          preview: dataUrl,
          slow: false,
        });
        logFileStatus(item.name, "ready");
        setImages((prev) => [...prev, dataUrl].slice(0, MAX_IMAGES));
      } catch (err) {
        window.clearTimeout(timer);
        const message =
          err instanceof Error ? err.message : "خواندن تصویر ناموفق بود.";
        patchAttach(item.id, {
          status: "error",
          error: message,
          slow: false,
        });
        logFileStatus(item.name, "error");
      }
    }
  }

  function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    void addCompressedImages(picked);
  }

  function pendingFromExtract(
    name: string,
    type: string,
    data: {
      text?: string;
      note?: string;
      weak?: boolean;
      limited?: boolean;
    }
  ): PendingFile {
    const limited =
      !!data.limited ||
      /\.psd$/i.test(name) ||
      /پشتیبانی محدود/.test(String(data.note || ""));
    const text = String(data.text || "");
    const useful = text.replace(/[\s\-–—_]/g, "").length;
    const weak = limited || !!data.weak || useful < 40;
    const status = limited
      ? LIMITED_EXTRACT_NOTE
      : weak
        ? WEAK_EXTRACT_NOTE
        : READ_OK_NOTE;
    return {
      name,
      type,
      text,
      note: status,
      weak,
      limited,
    };
  }

  async function extractOneFile(
    file: File
  ): Promise<{ ok: true; pending: PendingFile } | { ok: false; error: string }> {
    try {
      const isPlain =
        /\.(txt|csv|md|json|log)$/i.test(file.name) ||
        (file.type.startsWith("text/") && !file.type.includes("rtf"));
      if (isPlain) {
        const text = (await file.text()).slice(0, 70000);
        return {
          ok: true,
          pending: pendingFromExtract(file.name, file.type, {
            text,
            weak: !text.trim(),
          }),
        };
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error:
            String((data as { error?: string }).error || "") ||
            "خواندن فایل ناموفق بود.",
        };
      }
      return {
        ok: true,
        pending: pendingFromExtract(file.name, file.type, data),
      };
    } catch {
      return { ok: false, error: "خواندن فایل ناموفق بود." };
    }
  }

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    const imageFiles = picked.filter((file) => {
      const name = file.name.toLowerCase();
      return (
        file.type.startsWith("image/") &&
        !name.endsWith(".psd") &&
        file.type !== "image/vnd.adobe.photoshop"
      );
    });
    const docFiles = picked.filter((file) => !imageFiles.includes(file));
    if (imageFiles.length) void addCompressedImages(imageFiles);
    if (!docFiles.length) return;

    const created: AttachItem[] = docFiles.map((file) => ({
      id: attachId(),
      kind: "file",
      name: file.name,
      size: file.size,
      type: file.type,
      status: "preparing",
      slow: false,
    }));
    setAttachItems((prev) => [...prev, ...created]);
    for (const item of created) logFileStatus(item.name, "preparing");

    for (let i = 0; i < docFiles.length; i += 1) {
      const file = docFiles[i];
      const item = created[i];
      const timer = startSlowTimer(item.id, item.name);
      try {
        patchAttach(item.id, { status: "reading" });
        logFileStatus(item.name, "reading");
        const result = await extractOneFile(file);
        window.clearTimeout(timer);
        if (!stillHasAttach(item.id)) continue;
        if (!result.ok) {
          patchAttach(item.id, {
            status: "error",
            error: result.error,
            slow: false,
          });
          logFileStatus(item.name, "error");
          continue;
        }
        patchAttach(item.id, {
          status: "ready",
          pending: result.pending,
          slow: false,
        });
        logFileStatus(item.name, "ready");
        setFiles((prev) => [...prev, result.pending]);
      } catch {
        window.clearTimeout(timer);
        patchAttach(item.id, {
          status: "error",
          error: "خواندن فایل ناموفق بود.",
          slow: false,
        });
        logFileStatus(item.name, "error");
      }
    }
  }

  function speak(text: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fa-IR";
    window.speechSynthesis.speak(utterance);
  }

  function startVoice() {
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      setListening(false);
      return;
    }

    const Speech =
      (
        window as Window & {
          SpeechRecognition?: new () => SpeechRec;
          webkitSpeechRecognition?: new () => SpeechRec;
        }
      ).SpeechRecognition ||
      (
        window as Window & {
          webkitSpeechRecognition?: new () => SpeechRec;
        }
      ).webkitSpeechRecognition;

    if (!Speech) {
      alert("ویس در این مرورگر پشتیبانی نمی‌شود. Chrome یا Edge بزن.");
      return;
    }

    const rec = new Speech();
    rec.lang = "fa-IR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript || "";
      if (!text) return;
      setInput((prev) => (prev ? prev + " " + text : text));
    };

    recRef.current = rec;
    rec.start();
  }

  
  function ensureMsgId(msg: Message, index: number) {
    return msg.id || ("m-" + index + "-" + String(msg.content || "").slice(0, 12));
  }

  function patchMessageAt(convoId: string, index: number, patch: Partial<Message>) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convoId) return c;
        const messages = c.messages.map((m, i) => (i === index ? { ...m, ...patch } : m));
        return { ...c, messages };
      })
    );
  }

  async function postFeedback(payload: {
    rating: "up" | "down";
    messageId: string;
    reason?: string;
    userAsk?: string;
    assistantText?: string;
    action?: "rate" | "analyze";
  }) {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cpgai-user": username,
      },
      body: JSON.stringify({
        username,
        conversationId: active?.id || "",
        ...payload,
      }),
    });
    return (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      substantive?: boolean;
      reply?: string;
      learned?: boolean;
    };
  }

  async function rateMessage(index: number, rating: "up" | "down") {
    const convoId = active?.id;
    if (!convoId || !active) return;
    const msg = active.messages[index];
    if (!msg || msg.role !== "assistant" || msg.streaming) return;
    const messageId = ensureMsgId(msg, index);
    let userAsk = "";
    for (let i = index - 1; i >= 0; i -= 1) {
      if (active.messages[i].role === "user") {
        userAsk = visibleUserContent(active.messages[i]);
        break;
      }
    }
    if (rating === "up") {
      patchMessageAt(convoId, index, {
        id: messageId,
        feedback: "up",
        feedbackPanel: false,
        feedbackNote: "",
        feedbackAskAgain: false,
      });
      void postFeedback({
        rating: "up",
        messageId,
        userAsk,
        assistantText: msg.content,
        action: "rate",
      });
      return;
    }
    const opened = await postFeedback({
      rating: "down",
      messageId,
      userAsk,
      assistantText: msg.content,
      action: "rate",
      reason: "",
    });
    patchMessageAt(convoId, index, {
      id: messageId,
      feedback: "down",
      feedbackPanel: true,
      feedbackAskAgain: false,
      feedbackNote:
        opened.reply ||
        "ببخشید که پاسخ براتون مفید نبود. اگر بگید دقیقاً چه ایرادی داشت، همان را اصلاح می‌کنم.",
    });
  }

  async function submitFeedbackReason(index: number, reason: string) {
    const convoId = active?.id;
    if (!convoId || !active) return;
    const msg = active.messages[index];
    if (!msg) return;
    const messageId = ensureMsgId(msg, index);
    let userAsk = "";
    for (let i = index - 1; i >= 0; i -= 1) {
      if (active.messages[i].role === "user") {
        userAsk = visibleUserContent(active.messages[i]);
        break;
      }
    }
    const result = await postFeedback({
      rating: "down",
      messageId,
      reason,
      userAsk,
      assistantText: msg.content,
      action: "analyze",
    });
    patchMessageAt(convoId, index, {
      feedback: "down",
      feedbackPanel: true,
      feedbackAskAgain: !result.substantive,
      feedbackNote:
        result.reply ||
        (result.substantive
          ? "ممنون از بازخوردتان. اگر بخواهید پاسخ را با اصلاح بازتولید می‌کنم."
          : "لطفاً دلیل واقعی‌تان را بگویید تا بتوانم درست اصلاح کنم."),
    });
  }


  
  async function regenerateAt(assistantIndex: number, correctionHint = "") {
    const convoId = active?.id;
    if (!convoId || !active) return;
    if (pendingIds[convoId] || fileBusy) return;
    const msgs = active.messages;
    let userIdx = -1;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const userMsg = msgs[userIdx];
    const ask = visibleUserContent(userMsg) || userMsg.content || "";
    const hint = correctionHint.trim()
      ? "\n\n[اصلاح بر اساس بازخورد کاربر]: " + correctionHint.trim()
      : "";
    patchConversation(convoId, msgs.slice(0, userIdx));
    setImages(messageImages(userMsg));
    setFiles(
      (userMsg.files || []).map((row) => ({
        name: row.name || "file",
        type: row.type || "",
        text: row.text || "",
        note: "",
        weak: false,
        limited: false,
      }))
    );
    setAttachItems([]);
    setInput((ask + hint).trim());
    setTimeout(() => {
      const form = document.getElementById("cpgai-chat-form") as HTMLFormElement | null;
      form?.requestSubmit();
    }, 40);
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    const convoId = active?.id;
    if (!convoId) return;
    if ((!text && !images.length && !files.length) || pendingIds[convoId] || fileBusy)
      return;

    const firstFile = files[0];
    const attachedStatus = firstFile
      ? firstFile.limited
        ? LIMITED_EXTRACT_NOTE
        : firstFile.weak
          ? WEAK_EXTRACT_NOTE
          : READ_OK_NOTE
      : "";

    const userMessage: Message = {
      role: "user",
      content:
        text ||
        (images.length && !files.length ? "این عکس را بررسی کن." : ""),
      image: images[0] || undefined,
      images: images.length ? images : undefined,
      files: files.map((row) => ({
        name: row.name,
        type: row.type,
        text: row.text,
      })),
      attachedName: firstFile?.name,
      attachedStatus: attachedStatus || undefined,
      sourceText: files.map((row) => row.text).filter(Boolean).join("\n\n") || undefined,
    };
    const history = active?.messages?.length ? active.messages : [];
    const nextMessages = [...history, userMessage];

    let apiImages = images.slice();
    if (
      !apiImages.length &&
      (isSourceImageAsk(text) || isImageEditAsk(text))
    ) {
      const latest = findLatestImage(messages);
      if (latest) apiImages = [latest];
    }

    const apiMessages = nextMessages.map((msg, i) => {
      const imgs = i === nextMessages.length - 1 ? apiImages : messageImages(msg);
      const payload = {
        role: msg.role,
        content: apiUserContent(msg),
        image: imgs[0] || "",
        images: imgs,
        files: msg.files,
        file: msg.file,
        fileUrl: msg.fileUrl || msg.file?.url || "",
        fileName: msg.fileName || msg.file?.name || "",
        fileMime: msg.fileMime || msg.file?.mime || "",
      };
      return payload;
    });

    patchConversation(convoId, [
      ...nextMessages,
      {
        role: "assistant",
        content: "",
        streaming: true,
        streamingStatus: looksLikeSearchAsk(text) ? "search" : "think",
      },
    ]);
    delete draftsRef.current[convoId];
    setInput("");
    setImages([]);
    setFiles([]);
    setAttachItems([]);
    setMenuOpen(false);
    setPendingIds((prev) => ({ ...prev, [convoId]: true }));
    abortRef.current[convoId]?.abort();
    const ac = new AbortController();
    abortRef.current[convoId] = ac;

    function paintStream(
      nextText: string,
      done = false,
      status?: "think" | "search"
    ) {
      if (abortRef.current[convoId] !== ac) return;
      if (streamRafRef.current[convoId]) {
        cancelAnimationFrame(streamRafRef.current[convoId]);
      }
      if (done) {
        patchStreamText(convoId, nextText, true);
        return;
      }
      streamRafRef.current[convoId] = requestAnimationFrame(() => {
        streamRafRef.current[convoId] = 0;
        if (abortRef.current[convoId] !== ac) return;
        patchStreamText(convoId, nextText, false, status);
      });
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        cache: "no-store",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          "x-cpgai-user": username,
        },
        body: JSON.stringify({ messages: apiMessages, username }),
      });

      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("text/event-stream") && res.body) {
        let reply = "";
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const eat = (block: string) => {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const json = JSON.parse(line.slice(5).trim()) as {
                text?: string;
                done?: boolean;
                status?: "think" | "search";
              };
              if (json.status && !reply) {
                paintStream("", false, json.status);
              }
              if (json.done && typeof json.text === "string" && json.text.length) {
                // Final payload is authoritative (avoids rare mid-stream corruption).
                reply = stripSearchPrefix(json.text);
              } else if (json.text) {
                reply = stripSearchPrefix(reply + json.text);
              }
              if (reply || json.done) paintStream(reply, !!json.done);
            } catch {
              /* keep reading */
            }
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() || "";
          for (const block of blocks) eat(block);
        }
        if (buf.trim()) eat(buf);
        if (abortRef.current[convoId] !== ac) return;
        if (!reply.trim()) {
          patchConversation(convoId, [
            ...nextMessages,
            { role: "assistant", content: "پاسخی دریافت نشد." },
          ]);
        } else {
          paintStream(reply, true);
        }
      } else {
        const data = await res.json();
        if (abortRef.current[convoId] !== ac) return;
        const reply =
          stripSearchPrefix(data.text || data.error || "خطا در دریافت پاسخ");
        const extra = normalizeChatPayload(data as Record<string, unknown>);
        patchConversation(convoId, [
          ...nextMessages,
          {
            role: "assistant",
            content: reply,
            ...extra,
          },
        ]);
      }
    } catch {
      if (ac.signal.aborted || abortRef.current[convoId] !== ac) return;
      patchConversation(convoId, [
        ...nextMessages,
        {
          role: "assistant",
          content: "ارتباط با سرور برقرار نشد.",
        },
      ]);
    } finally {
      if (streamRafRef.current[convoId]) {
        cancelAnimationFrame(streamRafRef.current[convoId]);
        streamRafRef.current[convoId] = 0;
      }
      if (abortRef.current[convoId] === ac) {
        delete abortRef.current[convoId];
        setPendingIds((prev) => {
          const next = { ...prev };
          delete next[convoId];
          return next;
        });
      }
      void loadQuota();
    }
  }

  if (!username) return null;
  if (!ready) {
    return (
      <main className="cpg-bg flex h-[100dvh] items-center justify-center">
        <p className="rounded-3xl bg-white px-6 py-4 text-slate-500 shadow-sm">
          در حال بارگذاری گفتگوها...
        </p>
      </main>
    );
  }

  const sidebar = (
    <aside className={sidebarOpen ? "fixed inset-y-0 right-0 z-40 flex h-full w-72 shrink-0 flex-col p-3 md:sticky md:top-0 md:flex" : "hidden h-full w-72 shrink-0 flex-col p-3 md:sticky md:top-0 md:flex"}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl bg-white p-4 shadow-sm">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="font-bold text-[#0f2744]">گفتگوها</h2>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-xl px-2 py-1 text-sm text-slate-500 md:hidden"
          >
            بستن
          </button>
        </div>
        <button
          type="button"
          onClick={() => void newChat()}
          className="mb-4 w-full shrink-0 rounded-2xl bg-[#0f2744] px-4 py-3 text-white"
        >
          گفتگوی جدید
        </button>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {conversations.map((convo) => {
            const isActive = convo.id === conversationId;
            const renaming = editingId === convo.id;
            const iconBtn = isActive
              ? "shrink-0 rounded-lg p-1 text-white/80 hover:bg-white/10"
              : "shrink-0 rounded-lg p-1 text-slate-500 hover:bg-white";
            return (
              <div
                key={convo.id}
                className={
                  isActive
                    ? "flex items-center gap-1 rounded-2xl bg-[#0f2744] px-2 py-2 text-white"
                    : "flex items-center gap-1 rounded-2xl bg-slate-50 px-2 py-2"
                }
              >
                {convo.pinned ? (
                  <span
                    className={isActive ? "shrink-0 text-white/80" : "shrink-0 text-slate-400"}
                    title="سنجاق‌شده"
                  >
                    <IconPin filled />
                  </span>
                ) : null}
                {renaming ? (
                  <input
                    ref={renameRef}
                    data-rename-input="true"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(convo.id);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => {
                      if (!draftTitle.trim()) {
                        cancelRename();
                        return;
                      }
                      commitRename(convo.id);
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm text-[#0f2744]"
                    aria-label="عنوان گفتگو"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void openChat(convo.id)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startRename(convo.id, convo.title);
                    }}
                    className="min-w-0 flex-1 truncate px-1 text-right text-sm"
                    title={
                      pendingIds[convo.id]
                        ? "در حال پاسخ: " + convo.title
                        : convo.title
                    }
                  >
                    {convo.title}
                    {pendingIds[convo.id] ? (
                      <span className="mr-1 text-xs text-slate-400">
                        {" "}
                        در حال پاسخ
                      </span>
                    ) : null}
                  </button>
                )}
                {renaming ? null : (
                  <>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startRename(convo.id, convo.title);
                      }}
                      className={iconBtn}
                      aria-label="تغییر نام"
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      data-convo-menu="true"
                      onClick={(event) => openActionMenu(convo.id, event)}
                      className={iconBtn}
                      aria-label="اقدامات گفتگو"
                      aria-expanded={actionMenuId === convo.id}
                    >
                      <IconDots />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {actionMenuId ? (
        <div
          data-convo-menu="true"
          className="fixed z-50 w-52 overflow-hidden rounded-2xl bg-white py-1 text-right shadow-lg"
          style={{ top: actionMenuPos.top, right: actionMenuPos.right }}
        >
          {(() => {
            const target = conversations.find((item) => item.id === actionMenuId);
            if (!target) return null;
            return (
              <>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-sm text-[#0f2744] hover:bg-slate-50"
                  onClick={() => startRename(target.id, target.title)}
                >
                  تغییر نام
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-sm text-[#0f2744] hover:bg-slate-50"
                  onClick={() => void pinChat(target.id)}
                >
                  {target.pinned ? "برداشتن سنجاق" : "سنجاق کردن"}
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-sm text-[#0f2744] hover:bg-slate-50"
                  onClick={() => openInNewTab(target.id)}
                >
                  باز کردن در تب جدید
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-sm text-red-600 hover:bg-slate-50"
                  onClick={() => void deleteChat(target.id)}
                >
                  حذف
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </aside>
  );

  return (
    <main className="cpg-bg h-[100dvh] overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="بستن تاریخچه"
        />
      )}
      <div className="mx-auto flex h-full w-full max-w-7xl">
        {sidebar}

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4">
          <header className="mb-4 flex shrink-0 items-center justify-between rounded-3xl bg-white px-5 py-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="shrink-0 rounded-xl px-3 py-2 text-sm text-slate-500 md:hidden"
              >
                گفتگوها
              </button>
              <div className="min-w-0">
                <BrandMark subtitle={"کاربر: " + (displayName || username)} />
                {quotaLine ? (
                  <p className="mt-1 truncate text-xs text-slate-400">{quotaLine}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {role === "admin" && (
                <Link href="/admin" className="rounded-xl px-3 py-2 text-sm text-slate-500">
                  کاربران
                </Link>
              )}
              <InstallAppButton compact />
              <Link href="/settings" className="rounded-xl px-3 py-2 text-sm text-slate-500">
                تنظیمات
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-xl px-3 py-2 text-sm text-slate-500"
              >
                خروج
              </button>
            </div>
          </header>

          <section
            className={
              lightboxSrc
                ? "min-h-0 flex-1 space-y-3 overflow-hidden rounded-3xl bg-white p-5 shadow-sm"
                : "min-h-0 flex-1 space-y-3 overflow-y-auto rounded-3xl bg-white p-5 shadow-sm"
            }
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.role === "user"
                    ? "mr-auto max-w-[80%] min-w-0 rounded-3xl bg-[#0f2744] px-4 py-3 text-right text-white"
                    : "ml-auto max-w-[80%] min-w-0 rounded-3xl bg-[#eef3f8] px-4 py-3 text-right"
                }
              >
                {messageImages(msg).map((src, imgIdx) => (
                  <ChatImage
                    key={src.slice(0, 48) + imgIdx}
                    src={src}
                    alt={msg.role === "user" ? "عکس کاربر" : "عکس ساخته‌شده"}
                    onOpen={(openSrc) => setLightboxSrc(openSrc)}
                  />
                ))}
                {msg.role === "assistant" &&
                msg.streaming &&
                !visibleUserContent(msg).trim() ? (
                  <p className="text-sm text-slate-500">
                    {msg.streamingStatus === "search"
                      ? "در حال بررسی منابع..."
                      : "در حال بررسی..."}
                  </p>
                ) : visibleUserContent(msg) || msg.streaming ? (
                  msg.role === "assistant" &&
                  /^(تصویر ساخته شد\.?|[0-9۰-۹]+\s*تصویر ساخته شد\.?|عکس ویرایش شد\.?|فایل( شما| پاورپوینت| Word| PDF| Excel)? آماده شد\.?)$/.test(
                    visibleUserContent(msg).trim()
                  ) &&
                  !messageImageSrc(msg) &&
                  !hasFilePayload(msg) ? null : msg.role === "assistant" &&
                    msg.streaming ? (
                    <div className="whitespace-pre-wrap text-right">
                      {visibleUserContent(msg)}
                      <span className="cpgai-caret" aria-hidden />
                    </div>
                  ) : msg.role === "assistant" ? (
                    <ChatRichText text={visibleUserContent(msg)} />
                  ) : (
                    <div className="whitespace-pre-wrap text-right">
                      {visibleUserContent(msg)}
                    </div>
                  )
                ) : null}
                {msg.role === "user" && userAttachment(msg).name ? (
                  <div
                    className={
                      visibleUserContent(msg)
                        ? "mt-2 rounded-2xl bg-white/10 px-3 py-2 text-xs"
                        : "rounded-2xl bg-white/10 px-3 py-2 text-xs"
                    }
                  >
                    <div>{userAttachment(msg).name}</div>
                    <div className="mt-0.5 opacity-80">
                      {userAttachment(msg).status || READ_OK_NOTE}
                    </div>
                  </div>
                ) : null}
                {msg.role === "assistant" && hasFilePayload(msg) ? (
                  <FileCard msg={msg} />
                ) : null}
                {voiceOn && msg.role === "assistant" && !msg.streaming && msg.content ? (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => speak(msg.content)}
                      className="text-xs text-slate-500"
                    >
                      پخش صدا
                    </button>
                  </div>
                ) : null}
                {msg.role === "assistant" && !msg.streaming ? (
                  <MessageActions
                    content={visibleUserContent(msg) || msg.content || ""}
                    feedback={msg.feedback}
                    busy={!!(active && pendingIds[active.id])}
                    panelOpen={!!msg.feedbackPanel}
                    replyNote={msg.feedbackNote || ""}
                    askAgain={!!msg.feedbackAskAgain}
                    onCopy={() => {}}
                    onUp={() => void rateMessage(i, "up")}
                    onDown={() => void rateMessage(i, "down")}
                    onReload={() => void regenerateAt(i)}
                    onSubmitReason={(reason) => submitFeedbackReason(i, reason)}
                    onRegenerateFromFeedback={() =>
                      void regenerateAt(i, msg.feedbackNote || "")
                    }
                  />
                ) : null}
              </div>
            ))}

            <div ref={bottomRef} />
          </section>

          {attachItems.length > 0 && (
            <div className="mt-3 flex shrink-0 flex-wrap items-start gap-3">
              {attachItems.map((item) => {
                const busy =
                  item.status === "preparing" || item.status === "reading";
                const sizeLabel = formatFileSize(item.size);
                return (
                  <div
                    key={item.id}
                    className="flex min-w-[180px] max-w-[260px] flex-col gap-1 rounded-2xl bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    <div className="flex items-start gap-2">
                      {busy ? (
                        <span className="cpgai-spin mt-0.5" aria-hidden />
                      ) : item.status === "ready" ? (
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
                          aria-hidden
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white"
                          aria-hidden
                        >
                          !
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[#0f2744]">
                          {item.name}
                        </div>
                        {sizeLabel ? (
                          <div className="text-xs text-slate-500">{sizeLabel}</div>
                        ) : null}
                        <div
                          className={
                            item.status === "error"
                              ? "text-xs text-red-600"
                              : "text-xs text-slate-500"
                          }
                        >
                          {attachStatusText(item)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttach(item.id)}
                        className="shrink-0 text-sm text-red-600"
                      >
                        حذف
                      </button>
                    </div>
                    {item.kind === "image" && item.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.preview}
                        alt=""
                        className="mt-1 h-14 w-auto rounded-xl object-cover"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {listening && (
            <p className="mt-3 shrink-0 text-sm text-slate-500">در حال شنیدن...</p>
          )}

          <form id="cpgai-chat-form" onSubmit={sendMessage} className="mt-4 flex shrink-0 items-end gap-2">
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickImage}
              className="hidden"
            />
            <input
              ref={fileRef}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              onChange={onPickFile}
              className="hidden"
            />

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="rounded-2xl bg-white px-4 py-3"
                aria-label="پیوست"
              >
                +
              </button>
              {menuOpen && (
                <div className="absolute bottom-full right-0 z-10 mb-2 w-36 overflow-hidden rounded-2xl bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      imageRef.current?.click();
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-right hover:bg-slate-50"
                  >
                    تصویر
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fileRef.current?.click();
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-right hover:bg-slate-50"
                  >
                    فایل
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(
                        files.some((row) => row.text)
                          ? "از این فایل یک متن ارائه حرفه‌ای ۱۲ اسلایدی با نکات سخنرانی ارزش‌افزا بساز"
                          : "یک متن ارائه حرفه‌ای ۱۲ اسلایدی با نکات سخنرانی ارزش‌افزا بساز"
                      );
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-right hover:bg-slate-50"
                  >
                    ارائه
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      startVoice();
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-right hover:bg-slate-50"
                  >
                    {listening ? "توقف صدا" : "صدا"}
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={composerRef}
              value={input}
              rows={1}
              wrap="soft"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (loading || fileBusy) return;
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder="پیام یا توضیح ویرایش عکس"
              className="max-h-48 min-h-12 flex-1 resize-none overflow-y-auto rounded-2xl border bg-white px-4 py-3 leading-6 break-words"
            />
            <button
              type="submit"
              disabled={loading || fileBusy}
              className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
            >
              {fileBusy ? "در حال خواندن..." : "ارسال"}
            </button>
          </form>
        </div>
      </div>
      {lightboxSrc
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/75 p-4"
              style={{ zIndex: 9999 }}
              onClick={() => setLightboxSrc(null)}
              role="dialog"
              aria-modal="true"
              aria-label="پیش‌نمایش تصویر"
            >
              <button
                type="button"
                onClick={() => setLightboxSrc(null)}
                className="absolute top-4 left-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-3xl leading-none text-[#0f2744] shadow-lg"
                aria-label="بستن"
              >
                ×
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxSrc}
                alt="پیش‌نمایش بزرگ"
                className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain"
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body
          )
        : null}
    </main>
  );
}
