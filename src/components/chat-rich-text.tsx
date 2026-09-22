"use client";

import { useMemo, useState, type ReactNode } from "react";
import katex from "katex";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type Token =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean }
  | { type: "code"; value: string; lang: string };

function isLikelyMath(inner: string) {
  const s = inner.trim();
  if (!s || s.length > 2000) return false;
  if (/https?:\/\//i.test(s)) return false;
  return /[\\^_=]|\\frac|\\sum|\\left|\\right|ROI|IRR|GDP|NPV|\b[A-Za-z]{1,8}\s*=/.test(
    s
  );
}

function isCmdOrPathLine(line: string) {
  const s = line.trim();
  if (!s || s.length < 3) return false;
  if (/[\u0600-\u06FF]/.test(s) && !/^[A-Za-z]:\\/.test(s)) return false;
  return (
    /^[A-Za-z]:\\/.test(s) ||
    /^\\\\[^\\\s]/.test(s) ||
    /^\.?\/[A-Za-z0-9._\-\\/]+/.test(s) ||
    /^ms-settings:/i.test(s) ||
    /^(?:cd |chdir |dir |md |mkdir |copy |del |erase |reg |netsh |ipconfig |taskkill |tasklist |powershell(?:\.exe)?\s+|cmd(?:\.exe)?\s+|start\s+ms-)/i.test(
      s
    ) ||
    /^(?:reg\s+(?:add|query|delete)|rundll32\b)/i.test(s)
  );
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push(...splitTextAndCmds(buf));
      buf = "";
    }
  };

  while (i < n) {
    if (src.startsWith("```", i)) {
      flush();
      const nl = src.indexOf("\n", i + 3);
      const lang = src.slice(i + 3, nl === -1 ? n : nl).trim();
      const start = nl === -1 ? n : nl + 1;
      const endFence = src.indexOf("```", start);
      const body =
        endFence === -1 ? src.slice(start) : src.slice(start, endFence);
      const value = body.replace(/\n$/, "");
      if (/^(latex|tex|math)$/i.test(lang)) {
        out.push({ type: "math", display: true, value });
      } else {
        out.push({ type: "code", value, lang });
      }
      i = endFence === -1 ? n : endFence + 3;
      if (src[i] === "\n") i += 1;
      continue;
    }

    if (src.startsWith("\\[", i)) {
      flush();
      const end = src.indexOf("\\]", i + 2);
      const raw = end === -1 ? src.slice(i + 2) : src.slice(i + 2, end);
      out.push({ type: "math", display: true, value: raw.trim() });
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (src.startsWith("$$", i)) {
      flush();
      const end = src.indexOf("$$", i + 2);
      const raw = end === -1 ? src.slice(i + 2) : src.slice(i + 2, end);
      const tex = raw.trim();
      if (tex) out.push({ type: "math", display: true, value: tex });
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (src.startsWith("\\(", i)) {
      flush();
      const end = src.indexOf("\\)", i + 2);
      const raw = end === -1 ? src.slice(i + 2) : src.slice(i + 2, end);
      out.push({ type: "math", display: false, value: raw.trim() });
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (src[i] === "$" && src[i + 1] !== "$") {
      const end = src.indexOf("$", i + 1);
      if (end > i + 1) {
        const inner = src.slice(i + 1, end);
        if (isLikelyMath(inner) && !inner.includes("\n\n")) {
          flush();
          out.push({ type: "math", display: false, value: inner.trim() });
          i = end + 1;
          continue;
        }
      }
    }

    buf += src[i];
    i += 1;
  }
  flush();
  return out;
}

function splitTextAndCmds(text: string): Token[] {
  const lines = text.split("\n");
  const out: Token[] = [];
  let prose: string[] = [];
  let cmds: string[] = [];
  const flushProse = () => {
    if (prose.length) {
      out.push({ type: "text", value: prose.join("\n") });
      prose = [];
    }
  };
  const flushCmds = () => {
    if (cmds.length) {
      out.push({ type: "code", value: cmds.join("\n"), lang: "cmd" });
      cmds = [];
    }
  };
  for (const line of lines) {
    if (isCmdOrPathLine(line)) {
      flushProse();
      cmds.push(line);
    } else {
      flushCmds();
      prose.push(line);
    }
  }
  flushCmds();
  flushProse();
  return out;
}

function renderKatex(tex: string, display: boolean) {
  if (!String(tex || "").trim()) return "";
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      errorColor: "#64748b",
      output: "html",
      trust: false,
    });
  } catch {
    try {
      return katex.renderToString(tex.replace(/\\\\/g, "\\"), {
        displayMode: display,
        throwOnError: false,
        strict: false,
        errorColor: "#64748b",
        output: "html",
        trust: false,
      });
    } catch {
      return "";
    }
  }
}

function CopyBar({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="chat-copybar">
      <span className="chat-copybar-label">{label}</span>
      <button
        type="button"
        className="chat-copy-btn"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => undefined
          );
        }}
      >
        {copied ? "کپی شد" : "کپی"}
      </button>
    </span>
  );
}

function FormulaBox({ tex }: { tex: string }) {
  const html = useMemo(() => renderKatex(tex, true), [tex]);
  return (
    <span className="chat-box" dir="ltr">
      <CopyBar text={tex} label="فرمول" />
      <span className="chat-box-body chat-formula-body">
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{tex}</code>
        )}
      </span>
    </span>
  );
}

function InlineFormula({ tex }: { tex: string }) {
  const html = useMemo(() => renderKatex(tex, false), [tex]);
  return html ? (
    <span
      className="chat-formula-inline"
      dir="ltr"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <code dir="ltr">{tex}</code>
  );
}

function CodeBox({ value, lang }: { value: string; lang: string }) {
  const label = lang === "cmd" || /^(bash|shell|powershell|ps1|bat)$/i.test(lang)
    ? "دستور"
    : lang
      ? lang
      : "کد";
  // Use span (not div) so CodeBox is valid inside markdown <p> and avoids hydration errors.
  return (
    <span className="chat-box" dir="ltr">
      <CopyBar text={value} label={label} />
      <code className="chat-box-body chat-code-body">{value}</code>
    </span>
  );
}

function MarkdownChunk({ text }: { text: string }) {
  if (!text.trim()) {
    return text.includes("\n") ? <div className="h-2" /> : null;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
      rehypePlugins={[
        [
          rehypeKatex,
          { throwOnError: false, strict: "ignore", errorColor: "#64748b" },
        ],
      ]}
      components={{
        // Avoid invalid <p><div/></p> / <p><pre/></p> nesting from rich code boxes.
        p({ children }) {
          return <div className="chat-md-p">{children}</div>;
        },
        code({ className, children, ...props }) {
          const raw = String(children ?? "").replace(/\n$/, "");
          const lang = /language-(\w+)/.exec(className || "")?.[1] || "";
          const inline = !className && !raw.includes("\n");
          if (inline) {
            if (isCmdOrPathLine(raw)) {
              return <CodeBox value={raw} lang="cmd" />;
            }
            return (
              <code className="chat-inline-code" dir="ltr" {...props}>
                {raw}
              </code>
            );
          }
          return <CodeBox value={raw} lang={lang} />;
        },
        pre({ children }) {
          return <>{children}</>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function ChatRichText({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(String(text || "")), [text]);
  const nodes: ReactNode[] = tokens.map((tok, i) => {
    if (tok.type === "math") {
      return tok.display ? (
        <FormulaBox key={i} tex={tok.value} />
      ) : (
        <InlineFormula key={i} tex={tok.value} />
      );
    }
    if (tok.type === "code") {
      return <CodeBox key={i} value={tok.value} lang={tok.lang} />;
    }
    return <MarkdownChunk key={i} text={tok.value} />;
  });
  return (
    <div className="chat-rich" dir="rtl">
      {nodes}
    </div>
  );
}
