"use client";

import { useState } from "react";

const CHIPS = [
  "پاسخ غلط بود",
  "ناقص بود",
  "لحن مناسب نبود",
  "نامرتبط بود",
  "دیگر",
];

type Props = {
  content: string;
  feedback?: "up" | "down" | null;
  busy?: boolean;
  onCopy: () => void;
  onUp: () => void;
  onDown: () => void;
  onReload: () => void;
  onSubmitReason: (reason: string) => Promise<void> | void;
  onRegenerateFromFeedback?: () => void;
  panelOpen?: boolean;
  replyNote?: string;
  askAgain?: boolean;
};

function IconCopy() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H13" />
    </svg>
  );
}
function IconUp({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6 9V16H4.5A1.5 1.5 0 0 1 3 14.5V10.5A1.5 1.5 0 0 1 4.5 9H6Zm0 0 3.2-5.2A1.8 1.8 0 0 1 12.5 4.7V9H16a1.5 1.5 0 0 1 1.45 1.9l-1.1 5A1.5 1.5 0 0 1 14.9 17H6" />
    </svg>
  );
}
function IconDown({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M14 11V4h1.5A1.5 1.5 0 0 1 17 5.5v4A1.5 1.5 0 0 1 15.5 11H14Zm0 0-3.2 5.2A1.8 1.8 0 0 1 7.5 15.3V11H4a1.5 1.5 0 0 1-1.45-1.9l1.1-5A1.5 1.5 0 0 1 5.1 3H14" />
    </svg>
  );
}
function IconReload() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M16 10a6 6 0 1 1-2-4.5" />
      <path d="M16 4v4h-4" />
    </svg>
  );
}

function substantiveOffer(note: string) {
  return /بازتولید|دوباره|اصلاح/.test(note);
}

export default function MessageActions({
  content,
  feedback,
  busy,
  onCopy,
  onUp,
  onDown,
  onReload,
  onSubmitReason,
  onRegenerateFromFeedback,
  panelOpen,
  replyNote,
  askAgain,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
    onCopy();
  }

  async function submit(extra?: string) {
    const text = (extra || reason).trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSubmitReason(text);
      setReason("");
    } finally {
      setSending(false);
    }
  }

  const btn =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 disabled:opacity-40";

  return (
    <div className="mt-2 select-none">
      <div className="flex items-center gap-0.5">
        <button type="button" className={btn} title={copied ? "کپی شد" : "کپی"} aria-label="کپی" onClick={copy} disabled={busy}>
          <IconCopy />
        </button>
        <button
          type="button"
          className={btn + (feedback === "up" ? " text-emerald-600" : "")}
          title="پاسخ خوب بود"
          aria-label="فیدبک مثبت"
          onClick={onUp}
          disabled={busy}
        >
          <IconUp filled={feedback === "up"} />
        </button>
        <button
          type="button"
          className={btn + (feedback === "down" ? " text-rose-600" : "")}
          title="پاسخ خوب نبود"
          aria-label="فیدبک منفی"
          onClick={onDown}
          disabled={busy}
        >
          <IconDown filled={feedback === "down"} />
        </button>
        <button type="button" className={btn} title="بازتولید پاسخ" aria-label="بازتولید" onClick={onReload} disabled={busy}>
          <IconReload />
        </button>
        {copied ? <span className="mr-2 text-[11px] text-slate-500">کپی شد</span> : null}
      </div>

      {panelOpen ? (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 p-3 text-right text-xs text-slate-700">
          {replyNote ? <p className="mb-2 leading-6">{replyNote}</p> : null}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] hover:bg-slate-100"
                onClick={() => submit(chip === "دیگر" ? reason || "دیگر" : chip)}
                disabled={sending || busy}
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={askAgain ? "دلیل واقعی‌تان را بنویسید..." : "دلیل را بنویسید (اختیاری)"}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
              disabled={sending || busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || busy || !reason.trim()}
              className="rounded-xl bg-[#0f2744] px-3 py-2 text-[11px] text-white disabled:opacity-40"
            >
              ارسال
            </button>
          </div>
          {onRegenerateFromFeedback && !askAgain && replyNote && substantiveOffer(replyNote) ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-sky-700 underline"
              onClick={onRegenerateFromFeedback}
              disabled={busy}
            >
              همین پاسخ را با اصلاح بازتولید کن
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
