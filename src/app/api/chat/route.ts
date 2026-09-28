import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  persistOutputFile,
  isPublicMediaPath,
  savePublicFile,
  mediaDiskPath,
} from "@/lib/media-store";
import { extractUploadedBytes } from "@/lib/file-extract";
import { makeProfessionalPptx } from "@/lib/make-pptx";
import {
  fallbackPlanFromSource,
  isJunkSlideTitle,
  parseSlidePlan,
  sourceTextOnly,
  userAskOnly,
  type SlidePlan,
} from "@/lib/text-to-slides";
import {
  buildOfficeFile,
  buildPresentationScriptDoc,
  detectFileKind,
  detectDocumentIntent,
  isBilingualAsk,
  isDocReviseAsk,
  isFileBuildIntent,
  isForcedWordAsk,
  isPptxAsk,
  wantsVisualPptx,
  bilingualDocumentPrompt,
  looksLikeBilingualBody,
  looksLikeManagementPerformanceReport,
  looksLikeStockPerformanceDeck,
  isPerformanceAsk,
  extractAttachedDump,
  splitContractChunks,
  isHelpOrSystemAsk,
  documentSystemPrompt,
  extractDocumentBody,
  isJobProfileRequest,
  isPresentationScriptRequest,
  JOB_PROFILE_SAMPLE,
  looksLikeChatNotDocument,
  SAMPLE,
  isEnglishDocument,
  stripOrgBrand, brandForAsk,
  type FileKind,
} from "@/lib/office";
import { wantsFileOutput } from "@/lib/intent";
import { packFileSources } from "@/lib/file-pack";
import {
  collectPresentationInput,
  harvestSourceFacts,
  hasAttachedSource,
  looksLikeProposalSource,
  presentationScriptPrompt,
  presentationScriptQuality,
  retryInstruction,
  sourceBriefPrompt,
} from "@/lib/presentation-script";
import {
  attachImageSource,
  findLastUserImage,
  isDocumentWorkRequest,
  readImageDocument,
} from "@/lib/image-text";
import {
  buildImageScenes,
  collectEditPrompt,
  isCompositeImageAsk,
  collectCompositeEditPrompt,
  stripFakeToolJson,
  isShowImageAgainAsk,
  collectImagePrompt,
  parseTextSwapAsk,
  askOnly,
  isEditRetryAsk,
  collectMessageImages,
  findLastAnyImage,
  findLastUserImages,
  findResumeImageAsk,
  isImageEditAsk,
  isImageGenerateAsk,
  isImageWorkAsk,
  isIndustrialImageTopic,
  requestedImageCount,
  resumeImageCount,
  shouldStampLogo,
} from "@/lib/image-work";
import {
  isChartAsk,
  isChartExcelAsk,
  looksLikeMatplotlibDump,
  buildChartSpecFromChat,
  renderChartPng,
  buildChartExcel,
} from "@/lib/chart-render";
import {
  formatSearchContext,
  answerUsesSearchHits,
  formatShoppingFallback,
  isShoppingBrowseAsk,
  isWebRefusal,
  needsWebSearch,
  searchWeb,
  stripProviderLeak,
} from "@/lib/web-search";
import {
  chatCompletions,
  chatCompletionsStream,
  completionText,
  emitTextLive,
  hasReplacementChar,
  readSseCompletion,
  getAvalaiClient,
  getGapgptClient,
  getSinoxClient,
  getTextClient,
  isModelErrorText,
  parseCompletion,
  tokenLimitFields,
} from "@/lib/llm";
import {
  formatSteelStatsContext,
  isSteelCompareAsk,
  isSteelStatsAsk,
  readSteelStats,
} from "@/lib/steel-stats";
import {
  captureTeachMemory,
  formatMemoryPrompt,
  isMemoryOnlyAsk,
  listMemories,
  memoryPreferredKind,
} from "@/lib/memory";
import {
  getQuota,
  logUsageIfSuccess,
  noteModelUsage,
  quotaMessage,
  runUsage,
} from "@/lib/usage";
import { canonUsername } from "@/lib/users";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export const runtime = "nodejs";
export const maxDuration = 180;

const AVALAI_BASE = "https://api.avalai.ir/v1";

function wantsPptx(text: string) {
  if (isHelpOrSystemAsk(text)) return false;
  const t = (text || "").toLowerCase();
  // متن سخنرانی/اسکریپت → Word بماند
  if (
    /متن ارائه|اسکریپت ارائه|متن سخنرانی|اسکریپت سخنرانی/.test(t) &&
    !/پاورپوینت|پاور پوینت|pptx|اسلاید/.test(t)
  ) {
    return false;
  }
  if (detectFileKind(text) === "pptx" || isPptxAsk(text)) return true;
  const mentionsDeck =
    t.includes("پاورپوینت") ||
    t.includes("پاور پوینت") ||
    t.includes("pptx") ||
    t.includes("powerpoint") ||
    t.includes("ارائه") ||
    (t.includes("اسلاید") && !/اسلایدبندی|نکته سخنرانی/.test(t));
  return mentionsDeck && (isFileBuildIntent(text) || wantsVisualPptx(text));
}

function wantsSameContent(text: string) {
  const t = text || "";
  return (
    t.includes("همین") ||
    t.includes("همینو") ||
    t.includes("همین را") ||
    t.includes("همین رو") ||
    t.includes("همین فایل") ||
    t.includes("همین ورد") ||
    t.includes("همین متن") ||
    t.includes("تبدیل") ||
    t.includes("پاورپوینتش") ||
    t.includes("پاورپوینت کن")
  );
}

function findLastAssistantText(messages: IncomingMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "assistant" && (msg.content || "").trim()) {
      return msg.content || "";
    }
  }
  return "";
}

const PPT_PLAN_PROMPT = [
  "فقط JSON برگردان. بدون توضیح و بدون markdown.",
  '{"title":"","subtitle":"","slides":[{"title":"","bullets":["",""]}]}',
  "۶ تا ۱۲ اسلاید از خود منبع.",
  "هر اسلاید ۱ عنوان + ۳ تا ۵ گلوله کوتاه از متن منبع.",
  "اگر منبع آموزشی است ارائه آموزشی همان موضوع.",
  "اگر منبع قرارداد است ارائه قرارداد: طرفین، موضوع، تعهدات، زمان.",
  "اگر منبع گزارش است: یافته، عدد منبع، تحلیل، اقدام.",
  "قالب درآمد/KPI/عملکرد سالانه ممنوع مگر همان در منبع باشد.",
  "عنوان اسلاید دستور کاربر، فایل خوانده شد، قوی یا خوشگل، یا معرفی CPGAI نباشد.",
  "معرفی ممنوع است. من CPGAI هستم / دستیار هوشمند / در خدمت شما هستم را در اسلاید ننویس.",
  "اگر کاربر سند سازمانی/شرکتی خواست برند سی‌پی‌جی پارس را بیاور؛ اگر عمومی خواست برند را تحمیل نکن.",
  "اگر منبع انگلیسی است JSON انگلیسی باشد. عنوان‌ها را برعکس نکن: Professional Summary نه SUMMARY PROFESSIONAL.",
].join(" ");

function looksLikeBadPptFirstSlide(title: string) {
  return isJunkSlideTitle(title) || /گزارش عملکرد|قوی و خوشگل|فایل خوانده شد/i.test(title);
}

function isGapGptQuotaError(status: number, raw: string) {
  return status === 403 || /insufficient_user_quota/i.test(raw || "");
}

async function generateSlidePlan(sourceText: string): Promise<SlidePlan | "quota" | null> {
  const source = sourceText.slice(0, 24000);
  if (source.trim().length < 40) return null;
  const raw = await callTextModel(
    [
      { role: "system", content: PPT_PLAN_PROMPT },
      { role: "user", content: "منبع سند:\n" + source },
    ],
    { temperature: 0.2, max_tokens: 4000, fileText: true, continueParts: 1 }
  );
  if (/GAPGPT_QUOTA|insufficient_user_quota/i.test(raw || "")) return "quota";
  const plan = parseSlidePlan(raw);
  if (plan && !looksLikeBadPptFirstSlide(plan.slides[0]?.title || plan.title)) {
    return plan;
  }
  return null;
}

function collectAssistantChatSource(messages: IncomingMessage[]) {
  const parts: string[] = [];
  const lastIdx = Math.max(0, messages.length - 1);
  for (let i = 0; i < lastIdx; i += 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    let c = String(msg.content || "").trim();
    if (/فایل شما آماده شد/.test(c) && c.length < 180) continue;
    c = stripChatIntro(c, "");
    if (c.length < 80) continue;
    parts.push(c);
  }
  return parts.join("\n\n").slice(0, 28000);
}

function resolveWorkSource(
  messages: IncomingMessage[],
  lastText: string
): { text: string; kind: "file" | "chat" | "none" } {
  const fileDump = sourceTextOnly(lastText).trim();
  if (fileDump.length > 40) return { text: fileDump.slice(0, 28000), kind: "file" };
  const chat = collectAssistantChatSource(messages).trim();
  if (chat.length > 40) return { text: chat, kind: "chat" };
  return { text: "", kind: "none" };
}

function collectPptSourceText(
  messages: IncomingMessage[],
  lastText: string
) {
  const resolved = resolveWorkSource(messages, lastText);
  if (resolved.text.length > 40) return resolved.text;
  const ask = userAskOnly(lastText).trim();
  if (ask.length > 40) return ask.slice(0, 28000);
  return "";
}

async function collectConvertSource(
  messages: IncomingMessage[],
  lastText: string
) {
  const fromLast = sourceTextOnly(lastText);
  if (fromLast.length > 40) return fromLast.slice(0, 28000);
  const dump = lastUserFileDump(messages);
  if (dump) {
    const inner = sourceTextOnly(dump) || dump;
    if (inner.trim().length > 40) return inner.slice(0, 28000);
  }
  const prevWord = await extractPreviousWord(messages);
  if (prevWord.trim().length > 40) return prevWord.slice(0, 28000);
  const ppt = collectPptSourceText(messages, lastText);
  if (ppt.trim().length > 40) return ppt.slice(0, 28000);
  const lastAssistant = findLastAssistantText(messages);
  if (
    lastAssistant.trim().length > 160 &&
    !/فایل (?:شما|پاورپوینت|Word|PDF|Excel) آماده شد/.test(lastAssistant)
  ) {
    return (sourceTextOnly(lastAssistant) || lastAssistant).slice(0, 28000);
  }
  return "";
}

function isChannelError(raw: string) {
  return /no available channel|channel is not available|no channel/i.test(raw);
}

function looksTruncated(text: string, finishReason = "") {
  if (finishReason === "length" || finishReason === "max_tokens") return true;
  const t = (text || "").trim();
  if (!t) return false;
  const last = t.split("\n").filter(Boolean).pop() || "";
  if (/^#{1,3}\s+\S+$/.test(last)) return true;
  if (/[=+\-−×÷→←]\s*$/.test(last)) return true;
  if (/[(\[{]$/.test(last)) return true;
  if (/^\s*(?:[-*•]|\d+[\.\)])\s+\S.{0,24}$/.test(last)) return true;
  if (/[:：،,؛]\s*$/.test(last) && last.length < 80) return true;
  return false;
}

function textOnlyMessages(messages: unknown[], keepVision = false) {
  return messages.map((item) => {
    const msg =
      item && typeof item === "object"
        ? (item as { role?: string; content?: unknown })
        : {};
    if (Array.isArray(msg.content)) {
      if (keepVision) {
        return { role: msg.role || "user", content: msg.content };
      }
      const text = msg.content
        .map((part) => {
          const row =
            part && typeof part === "object"
              ? (part as { type?: string; text?: string })
              : {};
          return row.type === "text" ? row.text || "" : "";
        })
        .filter(Boolean)
        .join("\n");
      return { role: msg.role || "user", content: text || "" };
    }
    return { role: msg.role || "user", content: String(msg.content || "") };
  });
}

function pickFileTextClient() {
  const sinox = getSinoxClient();
  if (sinox) return sinox;
  const text = getTextClient();
  if (text && text.name !== "avalai") return text;
  return getGapgptClient();
}

async function callTextModel(
  messages: unknown[],
  extra?: {
    temperature?: number;
    max_tokens?: number;
    timeoutMs?: number;
    continueParts?: number;
    keepVision?: boolean;
    onDelta?: (chunk: string) => void;
    gapgptOnly?: boolean;
    fileText?: boolean;
  }
) {
  const gapgptKey = process.env.GAPGPT_API_KEY;
  const gapgptBase = (
    process.env.GAPGPT_BASE_URL || "https://api.gapgpt.app/v1"
  ).replace(/\/+$/, "");
  const envModel = process.env.GAPGPT_MODEL || "gpt-5.6-luna";
  const gapgptModels = [...new Set([envModel, "gpt-5.6-luna"])];
  const keepVision = !!extra?.keepVision && !extra?.fileText;
  const payload = textOnlyMessages(messages, keepVision);
  const onDelta = extra?.onDelta;
  const fileText = !!extra?.fileText;
  const preferred = fileText ? pickFileTextClient() : getTextClient();
  if (fileText) {
    console.log("FILE_TEXT_PROVIDER", preferred?.name === "sinox" ? "sinox" : preferred?.name || "none");
  }

  async function liveOut(text: string) {
    if (onDelta && text) await emitTextLive(text, onDelta);
    return text;
  }

  if (preferred?.name === "sinox") {
    try {
      if (onDelta) {
        const streamed = await chatCompletionsStream(
          preferred,
          {
            messages: payload,
            temperature: extra?.temperature,
            max_tokens: extra?.max_tokens,
          },
          { timeoutMs: extra?.timeoutMs, onDelta }
        );
        if (streamed.text && !isModelErrorText(streamed.text)) {
          if (!streamed.streamed) await emitTextLive(streamed.text, onDelta);
          return streamed.text;
        }
      } else {
        const data = await chatCompletions(
          preferred,
          {
            messages: payload,
            temperature: extra?.temperature,
            max_tokens: extra?.max_tokens,
          },
          { timeoutMs: extra?.timeoutMs }
        );
        const parsed = parseCompletion(data);
        const text = parsed.text;
        if (text && !isModelErrorText(text) && !parsed.error) {
          return liveOut(text);
        }
        if (parsed.error) {
          console.log("SINOX_ERROR", parsed.error.slice(0, 240));
        }
      }
    } catch (err) {
      console.log("SINOX_FAIL", err);
    }
  }

  if (onDelta) {
    try {
      if (keepVision) {
        const avalaiVision = getAvalaiClient();
        if (avalaiVision) {
          const streamed = await chatCompletionsStream(
            avalaiVision,
            {
              messages: payload,
              temperature: extra?.temperature,
              max_tokens: extra?.max_tokens,
            },
            { timeoutMs: extra?.timeoutMs, onDelta }
          );
          if (streamed.text && !isModelErrorText(streamed.text)) {
            if (!streamed.streamed) await emitTextLive(streamed.text, onDelta);
            return streamed.text;
          }
        }
      }
      if (gapgptKey) {
        for (const gapgptModel of gapgptModels) {
          const res = await fetch(gapgptBase + "/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + gapgptKey,
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              model: gapgptModel,
              stream: true,
              messages: payload,
              temperature: extra?.temperature,
              ...tokenLimitFields(gapgptModel, extra?.max_tokens ?? 4000),
            }),
            signal: extra?.timeoutMs
              ? AbortSignal.timeout(extra.timeoutMs)
              : undefined,
          });
          console.log("GAPGPT_STREAM", res.status, gapgptModel);
          if (res.status !== 200) continue;
          const ctype = res.headers.get("content-type") || "";
          if (
            ctype.includes("application/json") &&
            !ctype.includes("event-stream")
          ) {
            const data = await res.json().catch(() => ({}));
            noteModelUsage(data, gapgptModel);
            const text = completionText(data);
            if (text && !isModelErrorText(text)) {
              await emitTextLive(text, onDelta);
              return text;
            }
            continue;
          }
          const streamed = await readSseCompletion(
            res,
            gapgptModel,
            onDelta
          );
          if (streamed.text && !isModelErrorText(streamed.text)) {
            if (!streamed.streamed) await emitTextLive(streamed.text, onDelta);
            return streamed.text;
          }
        }
      }
      const avalaiLive = getAvalaiClient();
      if (avalaiLive && !keepVision && !fileText && !extra?.gapgptOnly) {
        const streamed = await chatCompletionsStream(
          avalaiLive,
          {
            messages: payload,
            temperature: extra?.temperature,
            max_tokens: extra?.max_tokens,
          },
          { timeoutMs: extra?.timeoutMs, onDelta }
        );
        if (streamed.text && !isModelErrorText(streamed.text)) {
          if (!streamed.streamed) await emitTextLive(streamed.text, onDelta);
          return streamed.text;
        }
      }
    } catch (err) {
      console.log("CHAT_STREAM_FAIL", err);
    }
  }

  if (keepVision) {
    const avalaiVision = getAvalaiClient();
    if (avalaiVision) {
      console.log("CHAT_PROVIDER", "avalai", "vision");
      const data = await chatCompletions(
        avalaiVision,
        {
          messages: payload,
          temperature: extra?.temperature,
          max_tokens: extra?.max_tokens,
        },
        { timeoutMs: extra?.timeoutMs }
      );
      const text = completionText(data);
      if (text) return liveOut(text);
    }
  }

  if (gapgptKey) {
    for (const gapgptModel of gapgptModels) {
      let history = payload;
      let combined = "";
      let truncated = false;
      const maxParts = Math.max(1, extra?.continueParts ?? 2);
      for (let part = 0; part < maxParts; part += 1) {
        console.log("GAPGPT_REQ", {
          base: gapgptBase,
          model: gapgptModel,
          messageCount: history.length,
          hasKey: Boolean(gapgptKey),
          part,
        });
        const res = await fetch(gapgptBase + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + gapgptKey,
          },
          body: JSON.stringify({
            model: gapgptModel,
            messages: history,
            temperature: extra?.temperature,
            ...tokenLimitFields(gapgptModel, extra?.max_tokens ?? 4000),
          }),
          signal: extra?.timeoutMs
            ? AbortSignal.timeout(extra.timeoutMs)
            : undefined,
        });
        const raw = await res.text();
        console.log("GAPGPT_STATUS", res.status);
        console.log("GAPGPT_RAW", raw.slice(0, 500));
        if (extra?.gapgptOnly && isGapGptQuotaError(res.status, raw)) {
          return liveOut("GAPGPT_QUOTA");
        }
        if (res.status !== 200) {
          console.log("MODEL_API_ERROR", res.status, raw.slice(0, 500));
          if (isChannelError(raw)) {
            console.log("GAPGPT_FALLBACK", gapgptModel);
            truncated = false;
            combined = "";
            break;
          }
          return liveOut(
            combined || "ساخت پاسخ انجام نشد. لطفاً دوباره تلاش کنید."
          );
        }
        let data: unknown = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          return liveOut(combined || raw);
        }
        noteModelUsage(data, gapgptModel);
        const parsed = parseCompletion(data);
        if (parsed.error && !parsed.text) {
          console.log("MODEL_API_ERROR", res.status, parsed.error.slice(0, 500));
          if (extra?.gapgptOnly && isGapGptQuotaError(res.status, parsed.error)) {
            return liveOut("GAPGPT_QUOTA");
          }
          if (isChannelError(parsed.error)) {
            console.log("GAPGPT_FALLBACK", gapgptModel);
            truncated = false;
            combined = "";
            break;
          }
          return liveOut(
            combined || "ساخت پاسخ انجام نشد. لطفاً دوباره تلاش کنید."
          );
        }
        const chunk = parsed.text;
        if (!chunk) return liveOut(combined || "پاسخی دریافت نشد.");
        if (isModelErrorText(chunk)) {
          console.log("MODEL_API_ERROR", res.status, chunk.slice(0, 500));
          return liveOut(
            combined || "ساخت پاسخ انجام نشد. لطفاً دوباره تلاش کنید."
          );
        }
        combined = combined ? combined + chunk : chunk;
        if (!looksTruncated(chunk, parsed.finishReason)) return liveOut(combined);
        console.log("GAPGPT_CONTINUE", parsed.finishReason || "truncated");
        history = [
          ...history,
          { role: "assistant", content: chunk },
          {
            role: "user",
            content:
              "متن قطع شد. از همان‌جا بدون تکرار مقدمه ادامه بده و پاسخ را کامل کن.",
          },
        ];
        truncated = true;
      }
      if (combined) return liveOut(combined);
      if (!truncated) continue;
    }
  }

  if (extra?.gapgptOnly || fileText) {
    return liveOut(
      fileText
        ? "ساخت سند انجام نشد. لطفاً دوباره تلاش کنید."
        : "ساخت سند با GapGPT انجام نشد."
    );
  }
  console.log("CHAT_PROVIDER", "avalai", "gpt-4o-mini");
  const avalai = getAvalaiClient();
  if (!avalai) return liveOut("کلید متن تنظیم نشده است.");
  const data = await chatCompletions(
    avalai,
    {
      messages: payload,
      temperature: extra?.temperature,
      max_tokens: extra?.max_tokens,
    },
    { timeoutMs: extra?.timeoutMs }
  );
  return liveOut(completionText(data) || "پاسخی دریافت نشد.");
}

const CAPABILITY_PROMPT = [
  "تولید یا پیشنهاد فایل DOCX، PPTX، PDF یا Excel تنها زمانی مجاز است که کاربر در پیام فعلی صراحتاً ساخت، ایجاد، تبدیل یا دانلود فایل، سند یا پاورپوینت را درخواست کند. ذکر نام فرمت، فایل پیوست، سابقه گفتگو و ترجیح ذخیره‌شده مجوز ساخت فایل نیست. برای پرسش‌های عادی، راهنمایی برنامه‌نویسی، دستورات ترمینال، عیب‌یابی، ترجمه و مکالمه روزمره حتماً با متن مارک‌داون و کدبلاک مناسب در همین چت پاسخ بده؛ فایل یا لینک دانلود تولید یا پیشنهاد نکن.",
  "اگر کاربر نمودار خواست، سیستم تصویر نمودار را می‌سازد؛ کد matplotlib یا python به‌جای تصویر ممنوع است.",
  "اگر کاربر بخواهد تصویر بسازی یا ویرایش کنی یا فایل Word، PDF، PowerPoint یا Excel بدهی، انجام می‌شود.",
  "هرگز نگو نمی‌توانی عکس یا فایل بسازی.",
  "هرگز نگو امکان ایجاد پیوست نداری، لینک قابل دانلود نخواهد بود، یا فایل باینری در دسترس نیست.",
  "اگر کاربر Word یا خروجی فایل خواست، فقط متن سند را بنویس؛ سیستم فایل را می‌سازد. عذرخواهی ممنوع است.",
  "راهنمای فتوشاپ، وعده صبر، یا «نمی‌توانم تصویر بسازم» به‌جای ساخت واقعی ممنوع است.",
  "اگر کاربر خواست متنی را از روی عکس حذف/عوض کنی یا فونت عکس را عوض کنی، ویرایش واقعی انجام می‌شود؛ نگو ابزار ادیت نداری.",
  "در ویرایش عکس، فونت را عوض نکن مگر کاربر صریحاً تغییر فونت خواسته باشد.",
  "اگر تعویض یک کلمه روی عکس ناقص بود، عذرخواهی طولانی و پیشنهاد فتوشاپ نده؛ بگو دوباره فقط همان کلمه را اصلاح می‌کنی.",
  "هرگز برای ویرایش عکس نگو از فتوشاپ، پینت، InShot یا PicsArt استفاده کند.",
  "هرگز در متن چت JSON، action_input، render_generated_image، generate_image یا tool جعلی ننویس.",
  "اگر عکس لازم است سیستم AvalAI را صدا می‌زند؛ اگر فایل لازم است makeDocument یا pptx ساخته می‌شود. تو فقط محتوا را بنویس.",
  "اگر چند عکس مرجع (چهره، لباس، بک‌گراند، نمونه کارت) پیوست شد، باید همان‌ها را در ویرایش واقعی ترکیب کند و صورت شخص را حفظ کند.",
  "موضوع عکس همان درخواست کاربر است. بانک آمار فولاد دلیل ساخت عکس فولادی نیست.",
  "اگر کاربر پرسید چرا فقط راجع به فولاد عکس می‌سازی، بگو از این به بعد طبق موضوع خود درخواست عکس ساخته می‌شود؛ نگو بانک آمار باعث آن شده.",
  "اگر کاربر عکس سند، قرارداد، شرح وظایف یا متن فرستاد، متن داخل تصویر را بخوان و استفاده کن.",
  "هرگز نگو نمی‌توانی عکس را بخوانی یا متن تصویر را استخراج نمی‌کنی.",
  "اگر داده به‌روز یا آمار رسمی لازم است و نتایج جستجو در پیام آمده، از همان استفاده کن و نگو به اینترنت دسترسی نداری.",
  "اگر کاربر خواست در سایت‌های ایرانی بگردی، قیمت مقایسه کنی، ارزان‌ترین فروشنده یا فروش اقساطی را پیدا کنی، از نتایج جستجوی وب جواب بده؛ نگو اینترنت نداری.",
  "هرگز از Sinox، Sinox API، AvalAI، GapGPT، Grok، گروک، نام مدل، یا مسیر API حرف نزن و در پاسخ ننویس.",
  "خودت را مدل زبانی عمومی معرفی نکن.",
  "معرفی ممنوع است. من CPGAI هستم / دستیار هوشمند / در خدمت شما هستم را ننویس.",
].join(" ");

const WEB_ANSWER_PROMPT = [
  "نتایج جستجوی وب همین حالا در اختیار توست. این یعنی جستجو انجام شده است.",
  "هرگز نگو نمی‌توانی به وب‌سایت یا اینترنت دسترسی داشته باشی.",
  "هرگز نگو اینترنت زنده، موتور جستجو یا استعلام قیمت نداری؛ نتایج همین‌جاست.",
  "هرگز Sinox، Grok، GapGPT، AvalAI یا نام مدل را در پاسخ ننویس.",
  "اگر سؤال خرید/سایت/قیمت/اقساطی است: از نتایج، گزینه‌ها را با لینک و قیمت (اگر در اسنیپت هست) فهرست کن؛ ارزان‌ترین را مشخص کن؛ سایت‌های اقساطی را جدا بگو. قالب آمار صنعتی فولاد ممنوع است.",
  "رقم از حافظه یا حدس ممنوع است. فقط عددی را بنویس که در نتایج آمده باشد.",
  "نوع داده را جدا بنویس و قاطی نکن: مقدار واقعی رخ‌داده، ظرفیت اسمی، برنامه/پیش‌بینی، برآورد غیررسمی.",
  "ظرفیت اسمی را مقدار واقعی ننام.",
  "پاسخ آماری را با این قالب بده:",
  "- رقم اصلی",
  "- بازه زمانی / سال",
  "- منبع",
  "- نکته محدودیت داده (اگر هست)",
  "اگر بخش «اعداد استخراج‌شده از اسنیپت‌ها» خالی نیست، باید همان ارقام را گزارش کنی و حق نداری بگویی یافت نشد.",
  "مقدار واقعی را رقم اصلی بگذار. ظرفیت را فقط اگر تولید واقعی نبود یا برای مقایسه کنارش بیاور.",
  "اگر چند منبع اختلاف دارند، اختلاف را بگو.",
  "فقط اگر هیچ عددی در اسنیپت‌ها و فهرست استخراج‌شده نبود، بگو یافت نشد.",
  "قالب چالش و اولویت مدیریتی ممنوع است مگر خود سؤال تحلیلی یا چندقسمتی باشد.",
].join("\n");

const INTERNAL_STATS_PROMPT = [
  "اگر بانک آمار داخلی در پیام آمده، اول از همان جواب بده.",
  "وقتی رقم از بانک داخلی است، حتماً بنویس: بر اساس بانک آمار داخلی CPGAI",
  "ظرفیت اسمی را با تولید واقعی قاطی نکن.",
  "رقم null یا خالی را حدس نزن.",
  "سال، واحد و منبع را بیاور.",
  "اگر سؤال مقایسه/رتبه بود، جدول شرکت | محصول | سال | مقدار | منبع را از بانک بیاور.",
  "اگر خانه‌ای در بانک نبود بنویس: در بانک داخلی موجود نیست.",
].join("\n");

const MIXED_TECH_STATS_PROMPT = [
  "این سؤال چندقسمتی است. همه بخش‌ها را کامل جواب بده. ناقص رها نکن.",
  "وسط فرمول، وسط لیست، یا وسط مرحله قطع نکن. اگر جا کم شد در ادامه همان بخش را تمام کن.",
  "",
  "## بخش فرایند",
  "مراحل فنی را کامل، مرتب و قابل استفاده برای کارشناس بنویس.",
  "",
  "## بخش شرکت‌ها و آمار",
  "فقط شرکت‌های مرتبط همان صنعت را بیاور.",
  "برای هر شرکت: نقش / محصول اصلی.",
  "آمار را فقط اگر در نتایج جستجو با سال و واحد معتبر است بنویس. عدد تنها و بی‌معنی مثل ۳۹۸۸۱۴۵ بدون واحد و سال ممنوع است.",
  "اگر موضوع آهن اسفنجی / DRI / احیای مستقیم ایران است، حداقل به بازیگران اصلی اشاره کن: فولاد مبارکه، فولاد خوزستان، ارفع، چادرملو، گل‌گهر / جهان فولاد و سایر تولیدکنندگان مهم DRI.",
  "اگر آمار دقیق در نتایج نبود، صریح بگو داده دقیق در نتایج نبود؛ حدس نزن.",
].join("\n");

const SYSTEM_PROMPT = [
  "نام داخلی تو CPGAI است.",
  "خودت را مدل عمومی، Grok، GPT، GapGPT، Sinox یا هر API معرفی نکن.",
  "در پاسخ هیچ نکته‌ای درباره Sinox API، AvalAI، GapGPT، Grok یا نام مدل ننویس.",
  "معرفی ممنوع است مگر کاربر بگوید خودت را معرفی کن.",
  "پاسخ را مستقیم با موضوع شروع کن. هیچ پاسخی با این‌ها شروع نشود:",
  "من CPGAI هستم / دستیار هوشمند سی‌پی‌جی پارس / نگاه راهبردی شما به عنوان دستیار.",
  "اگر کاربر گفت خودت را معرفی کن، فقط بنویس: CPGAI.",
  "کاربر را تحلیل‌گر فرض نکن. اگر او سؤال کرد تو باید توضیح بدهی. نگو «اطلاعات دقیقی ارائه دادید» یا از پاسخ او تعریف کن.",
  "فرمول را خوانا بنویس: CO2 را CO₂، H2 را H₂، H2O را H₂O. بلوک خالی $$ نگذار.",
  "زبان: فارسی رسمی سازمانی.",
  "قانون طلایی برای هر سؤال: اول مستقیم به همان چیزی که کاربر پرسیده جواب بده؛ از صفر و کامل. فرار از سؤال ممنوع است.",
  "هرگز فرض نکن کاربر قبلاً پاسخ یا تحلیل نوشته است. شروع با تعریف از پاسخ کاربر، «نکته تکمیلی»، یا جمع‌بندی حرف‌های او ممنوع است مگر در همان گفتگو واقعاً متن قبلی خودش باشد و صریحاً ادامه/نقد خواسته باشد.",
  "در ابتدای پاسخ تمجید سازمانی از کاربر ننویس. اول محتوا، آخر اگر لازم بود یک پیشنهاد کوتاه برای ادامه.",
  "نوع سؤال را تشخیص بده و همان قالب را اجرا کن؛ قالب نامربوط تحمیل نکن:",
  "- آموزشی / توضیح / فرایند / جزئیات / چگونه کار می‌کند: تعریف + مراحل کامل از صفر. قالب چالش/اولویت/معاونت ممنوع.",
  "- عددی / واقعیتی / آماری (میزان، ظرفیت، تعداد، قیمت، تاریخ): جواب مستقیم با سال/واحد/منبع. قالب چالش و اولویت ممنوع.",
  "- تحلیلی / راهبردی / مدیریتی فقط وقتی خودش چالش، اولویت، بهبود، ریسک، راهبرد یا تصمیم خواسته: پاسخ عمیق مدون با دلیل و اثر.",
  "- شناسنامه شغلی / شرح شغل / job profile: قالب منابع انسانی؛ گزارش عملکرد سالانه و KPI شرکتی ممنوع.",
  "- راهنما / تنظیمات / عیب‌یابی عمومی: مراحل عملی همان موضوع؛ فولاد و معدن ممنوع.",
  "هیچ سؤالی را به‌زور به قالب چالش‌های بهره‌برداری، چادرملو، CBAM، یا فروش پروژه بعدی نبر مگر خودش بخواهد.",
  "سؤال چندقسمتی را کامل جواب بده: هر بخش جدا و تمام.",
  "آمار شرکت‌ها باید با سال و واحد باشد. عدد تنها و بی‌معنی ممنوع است.",
  "وقتی سؤال صریحاً تحلیلی صنعتی (چالش/اولویت/گلوگاه) است در سطح مشاور ارشد جواب بده؛ برای بقیه سؤال‌ها آموزش یا واقعیت‌گویی روشن کافی است و لحن گزارش معاونت ممنوع است.",
  "کلمه واحد را استفاده نکن.",
  CAPABILITY_PROMPT,
].join("\n");

const EDUCATIONAL_PROCESS_PROMPT = [
  "این سؤال آموزشی/فرایندی است. باید خودِ موضوع را از صفر کامل توضیح بدهی.",
  "فرض نکن کاربر تحلیل‌گر است یا قبلاً تحلیل نوشته. اگر سؤال کرد تو توضیح بده. نگو اطلاعات دقیقی ارائه دادید.",
  "هرگز با تعریف و تمجید از پاسخ کاربر یا «نکته تکمیلی برای تحلیل‌های آتی» شروع نکن.",
  "پیشنهاد ادامه کار را فقط در یک خط کوتاه در انتها بگذار؛ بدنه پاسخ باید خود آموزش باشد.",
  "",
  "ساختار الزامی:",
  "1) تعریف روشن موضوع",
  "2) چرا اهمیت دارد (کوتاه)",
  "3) مسیرها/تکنولوژی‌های اصلی با توضیح",
  "4) مراحل فرایند به‌ترتیب (گام‌به‌گام، کامل، قابل استفاده برای کارشناس)",
  "5) ورودی‌ها، خروجی‌ها، و در صورت مرتبط بودن انرژی/انتشار یا محدودیت‌های کلیدی",
  "6) تفاوت با روش متعارف (اگر مرتبط است)",
  "7) محدودیت‌ها و پیش‌نیازهای اجرایی (مختصر)",
  "اگر موضوع فناوری یا فرایند صنعتی است، مسیرها و مراحل فنی مرتبط با همان موضوع سؤال را کامل بنویس؛ مثال نامرتبط نیاور.",
  "قالب چالش‌های بهره‌برداری معدن، اولویت اجرایی چادرملو، و گزارش معاونت ممنوع است مگر خود سؤال صریحاً چالش/اولویت خواسته باشد.",
].join("\n");

const FACTUAL_PROMPT = [
  "این سؤال عددی، واقعیتی یا آماری است.",
  "اول مستقیم به همان سؤال جواب بده.",
  "نوع داده را جدا کن: مقدار واقعی، ظرفیت اسمی، برنامه/پیش‌بینی، برآورد غیررسمی.",
  "عدد را با زمان/سال و منبع بگو. بدون زمان جواب نده.",
  "ظرفیت را مقدار واقعی ننام و رقم نساز.",
  "اگر قطعی نبود بگو یافت نشد.",
  "قالب چالش و اولویت مدیریتی ممنوع است.",
].join("\n");

const INDUSTRY_ANALYST_PROMPT = [
  "این سؤال باید مثل گزارش مشاور بهره‌برداری برای معاونت باشد. مقاله کلی قبول نیست.",
  "اول گلوگاه واقعی را نام ببر، بعد اولویت اجرایی بده.",
  "",
  "در بخش چالش‌های ایران اگر مرتبط است این محورها را جداگانه بنویس. هر چالش دقیقاً ۳ جزء داشته باشد:",
  "- چیست:",
  "- اثر در بهره‌برداری:",
  "- هزینه اگر حل نشود:",
  "محورها: انرژی (برق/گاز/آب)، فرسودگی ماشین‌آلات و قطعات، تأمین مالی و تحریم، ذخایر و خوراک، لجستیک، نیروی انسانی/پیمانکاری.",
  "عنوان خالی ممنوع است. هر مورد سازوکار بدهد نه شعار.",
  "",
  "بخش وضعیت خاص موضوع تکرار چالش‌های عمومی نباشد.",
  "اگر سؤال درباره چادرملو است، حتماً این محورها را اختصاصی و جدا بنویس:",
  "1) خوراک و عیار: کانسار بالغ اردکان–یزد، افت عیار، مخلوط‌سازی، نرمه/باطله، اثر روی آسیا و بازیابی (تحلیلی/برآوردی).",
  "2) وابستگی معدن و کارخانه: توقف بارگیری معدن یعنی گرسنگی مدار فرآوری/گندله؛ برعکس، توقف کارخانه یعنی دپوی سنگ و قفل ناوگان.",
  "3) انرژی و آب در بستر کویری: برق فرآوری، گاز گندله، آب محدود و بازچرخانی/انتقال؛ تابستان گلوگاه تولید است.",
  "4) آماده‌به‌کاری ناوگان: دامپتراک/شاول، قطعه تحریم‌شده، MTTR، ضریب آماده‌به‌کاری، گلوگاه بارگیری.",
  "5) گلوگاه حمل و دپو: ریل/واگن به مصرف‌کننده فولادی، دپوی اضطراری کنار خط، اثر روی فروش و سرمایه در گردش.",
  "چادرملو را مثل گل‌گهر یا سنگان ننویس.",
  "",
  "اولویت‌ها حداکثر ۵ مورد، غیرتکراری. هر کدام دقیقاً:",
  "### اولویت N: اقدام مشخص (نه شعار)",
  "- اقدام مشخص:",
  "- چرا الان:",
  "- اثر قابل اندازه‌گیری یا قابل مشاهده:",
  "- پیش‌نیاز:",
  "- افق زمانی: فوری / کوتاه‌مدت / میان‌مدت",
  "اولویت‌های شبیه هم ممنوع است.",
  "",
  "جمع‌بندی مدیریتی الزاماً فقط این ۳ خط را بگوید و تصمیم بدهد:",
  "- مهم‌ترین ریسک فعلی:",
  "- مهم‌ترین اهرم بهبود:",
  "- اولین تصمیم پیشنهادی مدیریت:",
].join("\n");

const VISION_PROMPT = [
  "اگر تصویر به پیام پیوست شده، آن را می‌بینی و باید استفاده کنی.",
  "نگو تصویر نداری، بارگذاری نشده، یا نمایش داده نشده.",
  "نام فایل، alt text یا عبارت لوگو به معنی نبود عکس نیست.",
  "هرگز نگو نمی‌توانی عکس یا فایل بسازی.",
  "هرگز نگو امکان ایجاد پیوست نداری، لینک قابل دانلود نخواهد بود، یا فایل باینری در دسترس نیست.",
].join(" ");

const HELP_PROMPT = [
  "این سؤال راهنمایی، تنظیمات، تعریف یا عیب‌یابی عمومی است.",
  "مستقیم به خود سؤال جواب بده؛ مرحله‌ای، دقیق و قابل اجرا.",
  "قالب چالش معدن، اولویت اجرایی، چادرملو و گزارش بهره‌برداری ممنوع است.",
  "حاشیه، مقدمه سازمانی طولانی، معرفی خودت و قالب تحمیلی ممنوع است.",
  "اگر موضوع ویندوز، Taskbar، Default Apps یا نرم‌افزار است، همان را توضیح بده.",
].join("\n");

const BRIEF_SYSTEM_PROMPT = [
  "نام داخلی تو CPGAI است.",
  "کاربر صریحاً پاسخ کوتاه یا خلاصه خواسته است.",
  "مختصر، دقیق و بدون حاشیه جواب بده.",
  "پاسخ را مستقیم با موضوع شروع کن.",
  "معرفی ممنوع است مگر کاربر بگوید خودت را معرفی کن.",
  "من CPGAI هستم / دستیار هوشمند سی‌پی‌جی پارس / نگاه راهبردی شما را ننویس.",
  "کاربر را تحلیل‌گر فرض نکن و نگو اطلاعات دقیقی ارائه دادید.",
  "لحن رسمی سازمانی فارسی است.",
  "خودت را مدل عمومی معرفی نکن.",
  "کلمه واحد را استفاده نکن.",
  CAPABILITY_PROMPT,
].join(" ");

function askedToIntroduce(text: string) {
  const t = askText(text);
  return /خودت را معرفی|خودتو معرفی|خودتان را معرفی|introduce yourself/i.test(t);
}

function stripChatIntro(text: string, userAsk = "") {
  const allowIntro = askedToIntroduce(userAsk);
  let t = String(text || "").replace(/^\uFEFF/, "");
  const lead = [
    /^(?:سلام[.،!]?\s*)?(?:من\s+)?CPGAI هستم،?\s*دستیار هوشمند سی[‌ ]?پی[‌ ]?جی پارس[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?دستیار هوشمند سی[‌ ]?پی[‌ ]?جی پارس[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?(?:من\s+)?CPGAI هستم[.،!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?دستیار هوشمند(?:\s+واحد)?[^.!\n]{0,60}[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?نگاه راهبردی شما[^.!\n]{0,80}[.!]?\s*/gim,
    /^(?:سلام[.،!]?\s*)?در خدمت شما هستم[.،!]?\s*/gim,
    /^(?:خوشحالم(?: که)? (?:بتوانم|می‌توانم) کمک کنم)[.،!]?\s*/gim,
    /^(?:اطلاعات دقیقی ارائه دادید)[^.!\n]{0,80}[.!]?\s*/gim,
  ];
  if (!allowIntro) {
    let prev = "";
    while (t !== prev) {
      prev = t;
      for (const re of lead) t = t.replace(re, "");
    }
  }
  t = t.replace(/^\s+/, "");
  if (allowIntro && (!t || /من CPGAI هستم|دستیار هوشمند سی‌پی‌جی پارس|نگاه راهبردی شما/.test(t))) {
    return "CPGAI.";
  }
  return t;
}

function polishChatFormulas(text: string) {
  let t = String(text || "");
  t = t.replace(/\$\$[\s\n]*\$\$/g, "");
  t = t.replace(/\$[\s]*\$/g, "");
  t = t.replace(/\bH2O\b/g, "H₂O");
  t = t.replace(/\bCO2\b/g, "CO₂");
  t = t.replace(/\bH2\b/g, "H₂");
  t = t.replace(/H_2O/g, "H₂O");
  t = t.replace(/CO_2/g, "CO₂");
  t = t.replace(/H_2(?![A-Za-z0-9])/g, "H₂");
  return t;
}

function wantsBriefReply(text: string) {
  const t = askText(text);
  return /(^|\s)(کوتاه|خلاصه)(\s|کن|بگو|جواب|$)/.test(t) || /کوتاه جواب|جواب کوتاه|خلاصه جواب/.test(t);
}

function askText(text: string) {
  return (text || "").split("محتوای فایل:")[0].split("نام فایل:")[0];
}

function isIndustrialTopic(text: string) {
  const t = askText(text);
  return /چادرملو|بهره‌برداری|بهره برداری|معدن|فولاد|مجتمع|ناوگان|خوراک|گندله|کنسانتره|صنایع معدنی|سنگ‌آهن|سنگ آهن/.test(
    t
  );
}

function isEducationalAsk(text: string) {
  const t = askText(text);
  return /مراحل|فرایند|فرآیند|توضیح بده|چگونه تولید|روش تولید|جزئیات کامل|آموزش/.test(
    t
  );
}

function isMultiPartAsk(text: string) {
  const t = askText(text);
  return (
    /همچنین|علاوه بر|از طرفی|و آمار|؛ همچنین|و بگو/.test(t) ||
    (isEducationalAsk(t) && /شرکت|آمار|پیشرو|تولیدشان/.test(t))
  );
}

function isAnalyticalAsk(text: string) {
  const t = askText(text);
  // Pure "explain the process" is educational, not strategic analysis.
  if (
    isEducationalAsk(t) &&
    !/چالش|اولویت|گلوگاه|راهبرد|استراتژی|ریسک|بهبود|راهکار|تحلیل کن|تصمیم مدیریت|پیشنهاد/.test(
      t
    )
  ) {
    return false;
  }
  return /چالش|اولویت|پیشنهاد می‌کنی|پیشنهاد کن|چگونه بهبود|چطور بهبود|بهبود دهیم|ریسک‌ها|راهبرد|استراتژی|گلوگاه|آسیب‌شناس|چه باید کرد|راهکار|تحلیل کن|تصمیم مدیریت/.test(
    t
  );
}

function isFactualAsk(text: string) {
  if (isAnalyticalAsk(text) || isEducationalAsk(text) || isMultiPartAsk(text)) {
    return false;
  }
  const t = askText(text);
  return /میزان|ظرفیت|تعداد|درصد|قیمت|تاریخ|آمار|رقم|تناژ|نرخ|تورم|چقدر|چقدره|چند تن|چند میلیون|سالانه|چه سالی|در کدام سال|اعلام‌شده|اعلام شده|تولید واقعی|ظرفیت اسمی|مقایسه|رتبه|بزرگ‌ترین|بزرگترین|تفاوت تولید/.test(
    t
  );
}

function isIndustrialAnalysisAsk(text: string) {
  return isIndustrialTopic(text) && isAnalyticalAsk(text);
}

function isHeavyIndustrialAnalysisAsk(text: string) {
  const t = askText(text);
  return isIndustrialTopic(t) && /چالش|اولویت|گلوگاه/.test(t);
}

function isGeneralHelpAsk(text: string) {
  if (isHelpOrSystemAsk(text)) return true;
  if (isHeavyIndustrialAnalysisAsk(text)) return false;
  const t = askText(text);
  const lower = t.toLowerCase();
  const hay = t + " " + lower;
  if (
    /taskbar|تسک‌بار|تسکبار|نوار وظیفه|start menu|منوی استارت|file explorer|اکسپلورر/.test(
      hay
    )
  ) {
    return true;
  }
  if (
    /ویندوز|\bwindows\b|تنظیمات|نرم‌افزار|اپلیکیشن|خطای برنامه|\berror\b|ارور|registry|رجیستری/.test(
      hay
    )
  ) {
    return true;
  }
  if (
    /عیب‌یابی|درست نمی‌شود|باز نمی‌شود|کار نمی‌کند|hang|crash/.test(hay)
  ) {
    return true;
  }
  if (
    !isIndustrialTopic(t) &&
    /(?:^|[؟\s])(?:چیست|یعنی چه|تعریف کن|فرق .{0,24} چیست)/.test(t)
  ) {
    return true;
  }
  return false;
}

function chatTokenLimit(
  ask: string,
  opts?: { brief?: boolean; web?: boolean }
) {
  if (opts?.brief) return 1200;
  if (isGeneralHelpAsk(ask)) return 2500;
  if (
    isIndustrialAnalysisAsk(ask) ||
    isMultiPartAsk(ask) ||
    isEducationalAsk(ask)
  ) {
    return 8000;
  }
  if (isFactualAsk(ask)) return 1800;
  if (opts?.web) return 2500;
  return 4000;
}

function countChatWords(text: string) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function hasAxis(text: string, patterns: RegExp[]) {
  return patterns.some((re) => re.test(text));
}

function looksLikeForcedAnalysis(text: string) {
  const t = text || "";
  return /چالش‌های ایران|اولویت‌های اجرایی|هزینه اگر حل نشود:|مهم‌ترین اهرم بهبود:|اثر در بهره‌برداری:/.test(
    t
  );
}

function looksLikeShallowChat(text: string, ask = "") {
  if (isGeneralHelpAsk(ask)) return false;
  if (isEducationalAsk(ask) || isMultiPartAsk(ask)) return false;
  const t = (text || "").trim();
  const words = countChatWords(t);
  const industrial = isHeavyIndustrialAnalysisAsk(ask);
  if (!industrial) return false;
  if (words < 750) return true;

  const bullets = t
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]|\d+[\.\)]/.test(line));
  if (bullets.length >= 4) {
    const avg =
      bullets.reduce((sum, line) => sum + countChatWords(line), 0) /
      bullets.length;
    if (avg < 16 && words < 1000) return true;
  }

  const headings = (t.match(/^#{1,3}\s+\S+/gm) || []).length;
  const blocks = t.split(/\n\s*\n/).filter((block) => block.trim().length > 40);
  if (headings < 3 && blocks.length < 4 && words < 900) return true;

  if (/باید فناوری به‌روز شود|توجه ویژه شود|لازم است بهبود یابد/.test(t)) {
    return true;
  }

  if (industrial) {
    const axes = [
      [/انرژی/, /برق/, /گاز/, /آب/],
      [/فرسود/, /ناوگان/, /قطعه/, /ماشین/],
      [/تأمین مالی/, /تامین مالی/, /تحریم/, /ارز/],
      [/ذخیر/, /خوراک/, /عیار/],
      [/لجستیک/, /ریل/, /حمل/, /دپو/],
      [/نیروی انسانی/, /پیمانکار/, /مهارت/],
    ];
    const axisHits = axes.filter((group) => hasAxis(t, group)).length;
    if (axisHits < 5) return true;
    if (!/چیست:/.test(t) || !/اثر در بهره‌برداری:|اثر در بهره برداری:/.test(t)) {
      return true;
    }
    if (!/هزینه اگر حل نشود:/.test(t)) return true;
    if (!/اقدام مشخص:/.test(t) || !/چرا الان:/.test(t)) return true;
    if (!/اثر قابل اندازه‌گیری|اثر قابل اندازه گیری|قابل مشاهده/.test(t)) {
      return true;
    }
    if (!/پیش‌نیاز:|پیش نیاز:/.test(t)) return true;
    if (!/فوری|کوتاه‌مدت|کوتاه مدت|میان‌مدت|میان مدت/.test(t)) return true;
    const priorityCount = (t.match(/اولویت\s*\d+/g) || []).length;
    if (priorityCount > 5) return true;
    if (priorityCount > 0 && priorityCount < 3) return true;
    if (
      !/مهم‌ترین ریسک فعلی:|مهم ترین ریسک فعلی:/.test(t) ||
      !/مهم‌ترین اهرم بهبود:|مهم ترین اهرم بهبود:/.test(t) ||
      !/اولین تصمیم پیشنهادی مدیریت:/.test(t)
    ) {
      return true;
    }
    const percents = t.match(/\d+[\s\u200c]*(٪|درصد)/g) || [];
    if (percents.length >= 3) {
      const unique = new Set(percents.map((item) => item.replace(/\s+/g, "")));
      if (unique.size === 1) return true;
    }
    if (/چادرملو/.test(ask)) {
      const mentions = (t.match(/چادرملو/g) || []).length;
      if (mentions < 4) return true;
      if (!/(خوراک|عیار)/.test(t)) return true;
      if (!/(معدن.{0,12}کارخانه|کارخانه.{0,12}معدن|وابستگی)/.test(t)) {
        return true;
      }
      if (!/(کویر|بازچرخانی|انتقال آب)/.test(t)) return true;
      if (!/(آماده‌به‌کار|آماده به کار|MTTR)/i.test(t)) return true;
      if (!/(دپو|ریل|واگن)/.test(t)) return true;
    }
  }

  return false;
}

function deepenInstruction(ask: string) {
  if (isMultiPartAsk(ask) || isEducationalAsk(ask)) {
    return [
      "پاسخ ناقص بود. همه بخش‌های سؤال را کامل کن.",
      "بخش فرایند را فنی و تمام‌شده بنویس. وسط لیست یا فرمول قطع نکن.",
      "بخش شرکت‌ها را جدا بنویس: نام، نقش/محصول.",
      "آمار فقط با سال و واحد معتبر. عدد بی‌معنی بدون واحد ممنوع.",
      "اگر آمار دقیق نبود بگو در نتایج نبود.",
    ].join(" ");
  }
  if (isFactualAsk(ask) || (needsWebSearch(ask) && !isAnalyticalAsk(ask))) {
    return [
      "این سؤال عددی یا واقعیتی است، نه گزارش چالش.",
      "فقط به خود سؤال جواب بده.",
      "نگو به سایت یا کدال دسترسی نداری؛ نتایج جستجو آمده است.",
      "رقم نساز. اگر در نتایج عدد با زمان نبود بگو داده قطعی یافت نشد.",
      "مقدار واقعی، ظرفیت اسمی، برنامه و برآورد غیررسمی را قاطی نکن.",
      "منبع را نام ببر.",
    ].join(" ");
  }
  const parts = [
    "پاسخ قبلی هنوز عمومی است. دوباره مثل گزارش مشاور بهره‌برداری برای معاونت بنویس.",
    "هر چالش ۳ جزء اجباری دارد: چیست / اثر در بهره‌برداری / هزینه اگر حل نشود.",
    "جمله کلی بدون سازوکار ممنوع است. اولویت‌های شبیه هم ممنوع است.",
    "اولویت‌ها حداکثر ۵ مورد؛ هر کدام: اقدام مشخص، چرا الان، اثر قابل اندازه‌گیری یا قابل مشاهده، پیش‌نیاز، افق زمانی.",
    "جمع‌بندی فقط این سه مورد: مهم‌ترین ریسک فعلی، مهم‌ترین اهرم بهبود، اولین تصمیم پیشنهادی مدیریت.",
    "یک درصد ثابت را برای همه چیز تکرار نکن. عدد را برآوردی/تحلیلی علامت بزن.",
  ];
  if (/چادرملو/.test(ask)) {
    parts.push(
      "بخش چادرملو را اختصاصی بنویس نه تکرار ایران: خوراک و عیار، وابستگی معدن و کارخانه، انرژی و آب کویری، آماده‌به‌کاری ناوگان، گلوگاه حمل و دپو."
    );
  }
  return parts.join(" ");
}

type IncomingMessage = {
  role?: string;
  content?: string;
  image?: string;
  images?: string[];
  files?: Array<{ name?: string; type?: string; text?: string }>;
  file?: { url?: string; name?: string; mime?: string };
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
};

function messageFileMeta(msg: IncomingMessage) {
  const nested = msg.file && typeof msg.file === "object" ? msg.file : {};
  return {
    url: String(nested.url || msg.fileUrl || ""),
    name: String(nested.name || msg.fileName || ""),
    mime: String(nested.mime || msg.fileMime || ""),
  };
}

function isWordFileMeta(meta: { url: string; name: string; mime: string }) {
  const hay = (meta.url + " " + meta.name + " " + meta.mime).toLowerCase();
  return /docx|wordprocessing|\.doc\b/.test(hay);
}

async function extractPreviousWord(messages: IncomingMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const meta = messageFileMeta(messages[i]);
    if (!meta.url || meta.url.startsWith("data:") || !isWordFileMeta(meta)) {
      continue;
    }
    const disk = mediaDiskPath(meta.url);
    if (!disk || !existsSync(disk)) continue;
    try {
      const bytes = new Uint8Array(await readFile(disk));
      const extracted = await extractUploadedBytes(
        meta.name || "prev.docx",
        meta.mime ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes
      );
      if ((extracted.text || "").trim().length > 40) {
        return extracted.text.trim();
      }
    } catch {
      /* next file */
    }
  }
  return "";
}

function lastUserFileDump(messages: IncomingMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const c = String(msg.content || "");
    if (/محتوای فایل:/.test(c) && c.length > 80) return c;
    const files = Array.isArray(msg.files) ? msg.files : [];
    const packed = packFileSources(files);
    if (packed.dump.length > 40) {
      return [c, "محتوای فایل:", packed.dump].filter(Boolean).join("\n");
    }
  }
  return "";
}

function conversationRevisionNotes(messages: IncomingMessage[]) {
  const notes: string[] = [];
  for (let i = messages.length - 2; i >= 0 && notes.length < 6; i -= 1) {
    const msg = messages[i];
    const c = String(msg.content || "").trim();
    if (c.length < 40) continue;
    if (/فایل شما آماده شد|فایل Word آماده شد|فایل Word اصلاح‌شده/.test(c) && c.length < 120) {
      continue;
    }
    if (
      /TABLE:|\||اصلاح|جدول|درست این|ستون|ردیف/.test(c) ||
      c.length > 400
    ) {
      notes.push(
        (msg.role === "assistant" ? "پاسخ قبلی:" : "یادداشت کاربر:") +
          "\n" +
          c.slice(0, 8000)
      );
    }
  }
  return notes.reverse().join("\n\n");
}

async function buildWordReviseSource(
  messages: IncomingMessage[],
  lastText: string
) {
  const parts = [
    "دستور اصلاح کاربر:",
    lastText,
    "",
    "خروجی باید گزارش کامل Word باشد نه فقط جدول. جدول اصلاح‌شده را داخل همان گزارش بگذار.",
    "هرگز نگو امکان پیوست فایل نداری و لینک data نساز. فایل واقعی Word ساخته می‌شود.",
  ];
  const dump = lastUserFileDump(messages);
  if (dump) {
    parts.push("", "آخرین فایل کاربر:", dump.slice(0, 22000));
  }
  const notes = conversationRevisionNotes(messages);
  if (notes) {
    parts.push("", "متن و جدول اصلاح‌شده در همین گفتگو:", notes.slice(0, 12000));
  }
  const prev = await extractPreviousWord(messages);
  if (prev) {
    parts.push("", "متن فایل Word قبلی:", prev.slice(0, 18000));
  }
  return parts.join("\n");
}

function storedOfficePayload(result: {
  text?: string;
  file?: { name?: string; url?: string; mime?: string };
  image?: string;
}) {
  const url = String(result.file?.url || "");
  if (!url || url.startsWith("data:")) {
    return {
      text: result.text || "ساخت فایل انجام نشد: ذخیره روی دیسک ناموفق بود.",
    };
  }
  return {
    text: result.text || "فایل شما آماده شد.",
    file: {
      name: result.file?.name || url.split("/").pop() || "report.docx",
      url,
      mime:
        result.file?.mime ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  };
}

function buildEditPrompt(userText: string) {
  if (isImageWorkAsk(userText) && !/چهره|صورت|آدم|شخص|پرتره/.test(userText || "")) {
    return [
      "Edit this EXISTING graphic. Do not invent a new poster or scene.",
      "Keep composition, aspect ratio, layout, photos, icons, and every text the user did not mention.",
      "Apply ONLY the requested change (delete one line, fix spelling, change font, etc.).",
      "Do not place the design as a small card on empty white space — keep full-frame like the input.",
      "Output an actual edited image, not instructions.",
      "User request: " + (userText || ""),
    ].join(" ");
  }
  return [
    "فقط تغییر خواسته‌شده را اعمال کن.",
    "چهره، بدن، لباس، مو و هویت فرد را دقیقاً حفظ کن.",
    "هیچ تغییری روی صورت نده مگر کاربر صریحاً خواسته باشد.",
    "درخواست کاربر: " + (userText || ""),
  ].join(" ");
}

function dataUrlToBlob(dataUrl: string) {
  const src = String(dataUrl || "");
  if (!src || !src.includes(",")) {
    return {
      blob: new Blob([]),
      filename: "image.png",
    };
  }
  const comma = src.indexOf(",");
  const header = src.slice(0, comma);
  const data = src.slice(comma + 1);
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const bytes = Buffer.from(data.replace(/\s/g, ""), "base64");
  const ext = mime.includes("png") ? "png" : "jpg";
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: mime }),
    filename: `image.${ext}`,
  };
}

function errMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function writeGeneratedPng(buffer: Buffer) {
  const url = savePublicFile("generated", "img-" + Date.now() + ".png", buffer);
  console.log("IMAGE_URL_RETURNED", url);
  return url;
}

function persistImageResult(image: string) {
  if (!image) {
    return { text: "ساخت تصویر انجام نشد. پاسخ تصویر خالی بود." };
  }
  try {
    const src = String(image);
    let raw = src;
    if (src.includes(",")) {
      raw = src.slice(src.indexOf(",") + 1);
    }
    raw = raw.replace(/\s/g, "");
    if (!raw) {
      return {
        text: "ساخت تصویر انجام شد اما ذخیره فایل ناموفق بود: داده تصویر خالی است",
      };
    }
    const buf = Buffer.from(raw, "base64");
    if (!buf.length) {
      return {
        text: "ساخت تصویر انجام شد اما ذخیره فایل ناموفق بود: داده تصویر خالی است",
      };
    }
    const url = writeGeneratedPng(buf);
    return { url };
  } catch (err) {
    console.log("SAVE_IMAGE_FAIL", err);
    return {
      text: "ساخت تصویر انجام شد اما ذخیره فایل ناموفق بود: " + errMessage(err),
    };
  }
}

async function toModelImage(image: string) {
  if (!image) return image;
  if (image.startsWith("data:") || image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }
  if (isPublicMediaPath(image)) {
    const { blob } = await imageInputToBlob(image);
    const buf = Buffer.from(await blob.arrayBuffer());
    return "data:" + (blob.type || "image/png") + ";base64," + buf.toString("base64");
  }
  return image;
}

async function imageInputToBlob(image: string) {
  if (image.startsWith("data:")) return dataUrlToBlob(image);
  if (isPublicMediaPath(image)) {
    const disk = mediaDiskPath(image);
    if (!disk) return dataUrlToBlob("");
    const bytes = await readFile(disk);
    const mime = image.toLowerCase().endsWith(".jpg") || image.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: mime }),
      filename: path.basename(image),
    };
  }
  if (image.startsWith("http://") || image.startsWith("https://")) {
    const imgRes = await fetch(image);
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const mime = imgRes.headers.get("content-type") || "image/png";
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: mime }),
      filename: "image.png",
    };
  }
  return dataUrlToBlob(image);
}

async function toDataUrl(item: { b64_json?: string; url?: string }) {
  if (item.b64_json) {
    return "data:image/png;base64," + item.b64_json;
  }

  if (item.url) {
    const imgRes = await fetch(item.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mime = imgRes.headers.get("content-type") || "image/png";
    return `data:${mime};base64,` + buf.toString("base64");
  }

  return "";
}

async function readImageResponse(response: Response) {
  const data = (await response.json().catch(() => ({}))) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  const first = data.data?.[0] || {};
  const image = await toDataUrl(first);
  return { data, image };
}


async function verifyTextSwap(
  apiKey: string,
  image: string,
  from: string,
  to: string
) {
  try {
    const src = await toModelImage(image);
    const response = await fetch(AVALAI_BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 80,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  'Look at this image. Answer ONLY with JSON: {"hasFrom":true|false,"hasTo":true|false}. ' +
                  'hasFrom=true if the exact Persian word "' +
                  from +
                  '" is still visible. hasTo=true if "' +
                  to +
                  '" is visible. Ignore similar words.',
              },
              { type: "image_url", image_url: { url: src } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, hasFrom: true, hasTo: false, raw };
    const parsed = JSON.parse(m[0]) as { hasFrom?: boolean; hasTo?: boolean };
    const hasFrom = !!parsed.hasFrom;
    const hasTo = !!parsed.hasTo;
    return { ok: !hasFrom && hasTo, hasFrom, hasTo, raw };
  } catch (err) {
    console.log("VERIFY_TEXT_SWAP_FAIL", err);
    return { ok: false, hasFrom: true, hasTo: false, raw: "" };
  }
}

async function resolveTextSwap(
  userText: string,
  messages?: { role?: string; content?: string }[]
) {
  const direct = parseTextSwapAsk(userText);
  if (direct) return direct;
  // Bare retry ("نشد") — reuse last swap ask from recent user turns.
  if (!isEditRetryAsk(userText)) return null;
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const msg = messages![i];
    if (msg.role !== "user") continue;
    const swap = parseTextSwapAsk(String(msg.content || ""));
    if (swap) return swap;
  }
  return null;
}

async function editImageWithTextSwapRetries(
  apiKey: string,
  source: string,
  userText: string,
  extra: string[] = [],
  messages?: { role?: string; content?: string }[]
) {
  const swap = await resolveTextSwap(userText, messages);
  const promptBase = swap
    ? collectEditPrompt(
        /نشد|درست نشد/.test(askOnly(userText))
          ? "کلمه «" + swap.from + "» را به «" + swap.to + "» عوض کن. فقط همین. فونت و بقیه را تغییر نده."
          : userText
      )
    : collectEditPrompt(userText);
  let prompt = promptBase;
  let last = await editImage(apiKey, source, prompt, true, extra);
  if (!last.image) return last;
  if (!swap) return last;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const check = await verifyTextSwap(apiKey, last.image, swap.from, swap.to);
    console.log("EDIT_VERIFY", { attempt, ...check, from: swap.from, to: swap.to });
    if (check.ok) return last;
    prompt = [
      promptBase,
      "Previous edit FAILED verification.",
      'The word "' + swap.from + '" is STILL visible. Remove it completely.',
      'Paint "' + swap.to + '" in the SAME place with the SAME font/style/color/size as the original.',
      "Do NOT change fonts elsewhere. Do not change any other region.",
    ].join("\n");
    const again = await editImage(apiKey, last.image, prompt, true, extra);
    if (again.image) last = again;
    else break;
  }
  const finalCheck = await verifyTextSwap(apiKey, last.image!, swap.from, swap.to);
  if (!finalCheck.ok) {
    return {
      ...last,
      text:
        "عکس را ویرایش کردم اما تعویض دقیق «" +
        swap.from +
        "» به «" +
        swap.to +
        "» هنوز کامل تأیید نشد. اگر هنوز غلط است بگویید «نشد» تا دوباره فقط همین را اصلاح کنم.",
    };
  }
  return last;
}


function formatImageApiError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "ساخت یا ویرایش عکس انجام نشد.";
  if (
    /safety system|rejected by the safety|content.?policy|content.?filter|responsibleai|minor|under[- ]?age|child/i.test(
      msg
    )
  ) {
    return [
      "سرویس تصویر AvalAI/Azure این درخواست را با فیلتر ایمنی رد کرد.",
      "معمولاً وقتی عکس کودک/نوجوان در ویرایش چهره باشد، یا ترکیب چهره واقعی با شخص معروف، چنین خطایی می‌آید.",
      "این محدودیت سیاست ارائه‌دهنده است؛ CPGAI نمی‌تواند آن را دور بزند.",
      "پیشنهاد: کارت را بدون تعویض چهره کودک بسازید (فقط قالب/لباس/بک‌گراند/اسم)، یا از عکس بزرگسال برای تست pipeline استفاده کنید؛ برای اعتراض همان Request ID را به support@avalai.ir بفرستید.",
      "جزئیات فنی: " + msg.slice(0, 280),
    ].join(" ");
  }
  return msg.slice(0, 400);
}

async function editImage(
  apiKey: string,
  image: string,
  prompt: string,
  rawPrompt = false,
  extraImages: string[] = []
) {
  try {
    if (!image) {
      return { text: "ویرایش عکس انجام نشد. تصویر مبدأ خالی است." };
    }
    const { blob, filename } = await imageInputToBlob(image);
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", rawPrompt ? prompt : buildEditPrompt(prompt));
    form.append("image", blob, filename);
    for (let i = 0; i < extraImages.length; i += 1) {
      const extra = await imageInputToBlob(extraImages[i]);
      form.append("image", extra.blob, extra.filename || "logo.png");
    }

    const response = await fetch(AVALAI_BASE + "/images/edits", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
      },
      body: form,
      signal: AbortSignal.timeout(90000),
    });

    const { data, image: edited } = await readImageResponse(response);
    noteModelUsage(data, "gpt-image-2");

    if (!edited) {
      return {
        text: formatImageApiError(
          data?.error?.message ||
            "ویرایش عکس انجام نشد. " + JSON.stringify(data).slice(0, 300)
        ),
      };
    }

    const saved = persistImageResult(edited);
    if (!saved.url) {
      return { text: saved.text || "ساخت تصویر انجام شد اما ذخیره فایل ناموفق بود." };
    }
    return { text: "عکس ویرایش شد.", image: saved.url };
  } catch (err) {
    const message = errMessage(err);
    console.log("EDIT_IMAGE_FAIL", err);
    return { text: formatImageApiError("ویرایش عکس انجام نشد: " + message) };
  }
}

async function generateImage(apiKey: string, prompt: string) {
  try {
    console.log("IMAGE_PROMPT", String(prompt || "").slice(0, 200));
    const response = await fetch(AVALAI_BASE + "/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(90000),
    });

    const { data, image } = await readImageResponse(response);
    noteModelUsage(data, "gpt-image-2");

    if (!image) {
      return {
        text: formatImageApiError(
          data.error?.message ||
            "ساخت تصویر انجام نشد. پاسخ تصویر خالی بود" +
              (response.status !== 200 ? " (کد " + response.status + ")." : ".")
        ),
      };
    }

    const saved = persistImageResult(image);
    if (!saved.url) {
      return { text: saved.text || "ساخت تصویر انجام شد اما ذخیره فایل ناموفق بود." };
    }
    return { text: "تصویر ساخته شد.", image: saved.url };
  } catch (err) {
    const message = errMessage(err);
    console.log("GENERATE_IMAGE_FAIL", err);
    return { text: formatImageApiError("ساخت تصویر انجام نشد: " + message) };
  }
}

function formatChatMessages(messages: IncomingMessage[]) {
  return messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      const imgs = collectMessageImages(msg);
      if (msg.role === "user" && imgs.length) {
        return {
          role: "user",
          content: [
            { type: "text", text: msg.content || "این عکس را ببین." },
            ...imgs.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        };
      }

      return {
        role: msg.role,
        content: msg.content || "",
      };
    });
}

async function generateImageSet(
  apiKey: string,
  lastText: string,
  count: number,
  logoSrc = "",
  history: IncomingMessage[] = []
) {
  const n = Math.max(1, Math.min(5, count));
  const scenes = buildImageScenes(history, lastText, n);
  console.log("IMAGE_SCENES", scenes);
  const jobs = scenes.map(async (scene) => {
    const made = await generateImage(apiKey, scene);
    if (!made.image) return made;
    if (!logoSrc) return made;
    const placed = await editImage(
      apiKey,
      made.image,
      [
        "Place the attached company logo onto this exact finished scene.",
        "Do not replace, restyle, or redraw the scene.",
        "Put the logo in a corner, undistorted, original aspect ratio, sharp, correct colors.",
        "Do not warp, stretch, morph, or redraw the logo.",
        "The second attached image is the logo. Do not ask for another upload.",
      ].join(" "),
      true,
      [logoSrc]
    );
    return placed.image ? placed : made;
  });
  const results = await Promise.all(jobs);
  const urls = results.map((row) => row.image || "").filter(Boolean);
  if (!urls.length) {
    return {
      text: results[0]?.text || "ساخت تصویر انجام نشد.",
    };
  }
  return {
    text: urls.length > 1 ? urls.length + " تصویر ساخته شد." : "تصویر ساخته شد.",
    image: urls[0],
    images: urls,
  };
}

async function completeChat(
  apiKey: string,
  messages: IncomingMessage[],
  extra?: {
    brief?: boolean;
    deepen?: boolean;
    ask?: string;
    webContext?: string;
    internalContext?: string;
    memoryPrompt?: string;
    max_tokens?: number;
    onDelta?: (chunk: string) => void;
  }
) {
  const brief = !!extra?.brief;
  const ask = extra?.ask || "";
  const formatted = formatChatMessages(messages);
  if (extra?.deepen) {
    formatted.push({ role: "user", content: deepenInstruction(ask) });
  }

  const helpAsk = isGeneralHelpAsk(ask);
  const hasVision = messages.some((msg) => collectMessageImages(msg).length > 0);
  const factual = isFactualAsk(ask);
  const educational = isEducationalAsk(ask) && !helpAsk;
  const industrialAnalysis =
    isHeavyIndustrialAnalysisAsk(ask) && !helpAsk && !educational;
  const mixed = isMultiPartAsk(ask) && !helpAsk;
  const webContext = extra?.webContext || "";
  const internalContext = extra?.internalContext || "";
  const internalBlock = internalContext
    ? "\n\n" + INTERNAL_STATS_PROMPT + "\n\n" + internalContext
    : "";
  const tokens =
    extra?.max_tokens ||
    chatTokenLimit(ask, { brief, web: !!webContext });
  const visionBlock = hasVision ? "\n\n" + VISION_PROMPT : "";
  const system = brief
    ? BRIEF_SYSTEM_PROMPT + visionBlock
    : helpAsk
      ? SYSTEM_PROMPT + "\n\n" + HELP_PROMPT + internalBlock + visionBlock
      : educational
        ? SYSTEM_PROMPT +
          "\n\n" +
          EDUCATIONAL_PROCESS_PROMPT +
          internalBlock +
          (webContext ? "\n\n" + WEB_ANSWER_PROMPT + "\n\n" + webContext : "") +
          visionBlock
        : mixed
          ? SYSTEM_PROMPT +
            "\n\n" +
            MIXED_TECH_STATS_PROMPT +
            internalBlock +
            (webContext ? "\n\n" + WEB_ANSWER_PROMPT + "\n\n" + webContext : "") +
            visionBlock
          : webContext
            ? SYSTEM_PROMPT + internalBlock + "\n\n" + WEB_ANSWER_PROMPT + "\n\n" + webContext + visionBlock
            : factual
              ? SYSTEM_PROMPT + internalBlock + "\n\n" + FACTUAL_PROMPT + visionBlock
              : industrialAnalysis
                ? SYSTEM_PROMPT + internalBlock + "\n\n" + INDUSTRY_ANALYST_PROMPT + visionBlock
                : SYSTEM_PROMPT + internalBlock + visionBlock;
  const memoryBlock = extra?.memoryPrompt ? "\n\n" + extra.memoryPrompt : "";
  const identityLock = [
    "قفل هویت: نام تو فقط CPGAI است.",
    "هرگز از Sinox، Sinox API، AvalAI، GapGPT، Grok، گروک، t-grok، grok-4.5 یا نام مدل حرف نزن.",
    "هرگز نگو به اینترنت/مرورگر/جستجو دسترسی نداری اگر نتایج جستجو در پیام هست.",
    "اگر نتایج جستجو هست، همان را خلاصه و مفید جواب بده.",
    "برای هر سؤال: اول خود سؤال را از صفر جواب بده. فرض نکن کاربر قبلاً تحلیل داده. با تمجید یا نکته تکمیلی شروع نکن.",
    "قالب چالش معدن/چادرملو/اولویت اجرایی را فقط وقتی خود سؤال چالش یا اولویت خواسته استفاده کن.",
  ].join(" ");
  const systemWithMemory = identityLock + "\n\n" + system + memoryBlock +
    "\n\nاین مسیر پاسخ متنی چت است. پاسخ را فقط به صورت مارک‌داون و کدبلاک مناسب داخل چت بنویس. فایل یا لینک دانلود تولید یا پیشنهاد نکن؛ ترجیحات حافظه یا فایل‌های قبلی این قانون را تغییر نمی‌دهند.";

  return callTextModel(
    [
      {
        role: "system",
        content: systemWithMemory,
      },
      ...formatted,
    ],
    {
      temperature: brief || helpAsk || (factual && !mixed) ? 0.2 : 0.32,
      max_tokens: tokens,
      continueParts: helpAsk ? 1 : 2,
      keepVision: hasVision,
      onDelta: extra?.onDelta,
    }
  );
}

async function chatText(
  apiKey: string,
  messages: IncomingMessage[],
  memoryPrompt = "",
  onDelta?: (chunk: string) => void,
  onStatus?: (status: "think" | "search") => void
) {
  const lastText =
    [...messages].reverse().find((msg) => msg.role === "user")?.content || "";
  const brief = wantsBriefReply(lastText);
  const helpAsk = isGeneralHelpAsk(lastText);

  let internalContext = "";
  let internalIncomplete = true;
  let compareAsk = isSteelCompareAsk(lastText);
  if (!helpAsk && (isSteelStatsAsk(lastText) || compareAsk)) {
    try {
      const stats = await readSteelStats();
      const packed = formatSteelStatsContext(lastText, stats);
      internalContext = packed.prompt;
      internalIncomplete = packed.incomplete;
      compareAsk = compareAsk || packed.compare;
    } catch {
      internalContext = "";
    }
  }

  const liveOverride = /آخرین گزارش|آخرین آمار|کدال|به‌روز|به روز/.test(lastText);
  const wantWeb =
    !helpAsk &&
    needsWebSearch(lastText) &&
    !(compareAsk && internalContext && !liveOverride) &&
    (!internalContext ||
      internalIncomplete ||
      liveOverride);

  const tokens = chatTokenLimit(lastText, { brief, web: wantWeb });
  const allowDeepen = !helpAsk && !brief && isHeavyIndustrialAnalysisAsk(lastText);

  function finalizeText(text: string) {
    return polishChatFormulas(
      stripChatIntro(stripFakeToolJson(stripProviderLeak(text)), lastText)
    );
  }

  async function repairBrokenPersian(text: string) {
    const dirty = String(text || "");
    if (!hasReplacementChar(dirty)) return dirty;
    try {
      const fixed = await callTextModel(
        [
          {
            role: "system",
            content:
              "Only repair invalid Unicode replacement characters (U+FFFD / �) in Persian text. " +
              "Replace each � sequence with the correct Persian letters so words read naturally. " +
              "Keep every other character exactly the same. Output the full repaired text only. " +
              "Do not add greetings, notes, or markdown.",
          },
          {
            role: "user",
            content: dirty,
          },
        ],
        { temperature: 0, max_tokens: Math.min(4000, Math.max(400, dirty.length + 200)), continueParts: 1 }
      );
      const out = finalizeText(fixed);
      if (out && !hasReplacementChar(out) && out.length > dirty.length * 0.5) {
        return out;
      }
    } catch (err) {
      console.log("REPAIR_PERSIAN_FAIL", err);
    }
    // Last resort: drop replacement chars so the UI is not littered with �
    return dirty.replace(/\uFFFD+/g, "");
  }

  async function once(opts?: {
    deepen?: boolean;
    webContext?: string;
    silent?: boolean;
  }) {
    // Never stream raw model tokens — Sinox/Grok may leak provider identity mid-stream.
    const run = async () =>
      completeChat(apiKey, messages, {
        brief,
        ask: lastText,
        internalContext,
        memoryPrompt,
        webContext: opts?.webContext,
        deepen: !!opts?.deepen,
        max_tokens: tokens,
        onDelta: undefined,
      });
    let text = await run();
    let clean = finalizeText(text);
    if (hasReplacementChar(clean)) {
      console.log("CHAT_FFFD_RETRY");
      text = await run();
      clean = finalizeText(text);
    }
    if (hasReplacementChar(clean)) {
      console.log("CHAT_FFFD_REPAIR");
      clean = await repairBrokenPersian(clean);
    }
    if (onDelta && clean && !opts?.silent) {
      await emitTextLive(clean, onDelta);
    }
    return clean;
  }

  async function emitFinal(text: string) {
    const clean = finalizeText(text);
    if (onDelta && clean) await emitTextLive(clean, onDelta);
    return clean;
  }

  if (onDelta) {
    onStatus?.(wantWeb ? "search" : "think");
    if (wantWeb) {
      const avalai = getAvalaiClient();
      if (avalai) {
        const found = await searchWeb(avalai.apiKey, lastText);
        if (found.ok) {
          const webContext = formatSearchContext(found.hits);
          const shoppingAsk = isShoppingBrowseAsk(lastText);
          console.log("CHAT_ONCE", {
            deepen: false,
            web: true,
            shopping: shoppingAsk,
            tokens,
            stream: true,
          });
          // Shopping/browse: do not trust the LLM to use hits — answer from search.
          if (shoppingAsk) {
            const text = await emitFinal(
              formatShoppingFallback(found.hits, lastText)
            );
            return { text };
          }
          let text = await once({ webContext, silent: true });
          if (
            (isWebRefusal(text) ||
              /Sinox|grok-4|گروک|در گوگل|گوگل سرچ/i.test(text) ||
              !answerUsesSearchHits(text, found.hits)) &&
            !helpAsk
          ) {
            console.log("CHAT_ONCE", { deepen: true, web: true, tokens, stream: true });
            const direct = await once({ deepen: true, webContext, silent: true });
            if (
              !isWebRefusal(direct) &&
              direct.trim() &&
              answerUsesSearchHits(direct, found.hits)
            ) {
              text = direct;
            }
          }
          if (
            isWebRefusal(text) ||
            /Sinox|grok-4|گروک|به اینترنت زنده|در گوگل|گوگل سرچ/i.test(text) ||
            !answerUsesSearchHits(text, found.hits)
          ) {
            text = formatShoppingFallback(found.hits, lastText);
          }
          text = await emitFinal(text);
          return { text };
        }
      }
    }
    console.log("CHAT_ONCE", { deepen: false, web: false, tokens, stream: true });
    let text = await once({ silent: true });
    if (isWebRefusal(text) || /Sinox|grok-4|گروک/i.test(text)) {
      text =
        "برای این سؤال الان نتیجه وب در دسترس نبود. یک‌بار دیگر بپرسید.";
    }
    text = await emitFinal(text);
    return { text };
  }

  if (internalContext && !wantWeb) {
    console.log("CHAT_ONCE", { deepen: false, web: false, tokens });
    return { text: await once() };
  }

  if (wantWeb) {
    const avalai = getAvalaiClient();
    if (!avalai) {
      if (internalContext) {
        console.log("CHAT_ONCE", { deepen: false, web: false, tokens });
        return { text: await once() };
      }
      return {
        text: "برای جستجوی وب کلید AvalAI لازم است. سؤال متنی بدون جستجو پاسخ داده می‌شود.",
      };
    }
    const found = await searchWeb(avalai.apiKey, lastText);
    if (found.ok) {
      const webContext = formatSearchContext(found.hits);
      if (isShoppingBrowseAsk(lastText)) {
        console.log("CHAT_ONCE", { deepen: false, web: true, shopping: true, tokens });
        return { text: finalizeText(formatShoppingFallback(found.hits, lastText)) };
      }
      console.log("CHAT_ONCE", { deepen: false, web: true, tokens });
      let text = await once({ webContext });
      const broken = looksLikeForcedAnalysis(text) || isWebRefusal(text);
      if (broken && !helpAsk) {
        console.log("CHAT_ONCE", { deepen: true, web: true, tokens });
        const direct = await once({ deepen: true, webContext });
        if (
          (!looksLikeForcedAnalysis(direct) && !isWebRefusal(direct)) ||
          countChatWords(direct) < countChatWords(text)
        ) {
          text = direct;
        }
      }
      if (
        !isMultiPartAsk(lastText) &&
        !isEducationalAsk(lastText) &&
        (isWebRefusal(text) || (/یافت نشد/.test(text) && found.stats.length))
      ) {
        const actual = found.stats.filter((item) => item.kind === "actual");
        const usable = actual.length ? actual : found.stats;
        const first = usable[0];
        if (first) {
          text = [
            "رقم اصلی: " + first.raw + (first.kind === "capacity" ? " (ظرفیت؛ تولید واقعی در اسنیپت مشخص نشد)" : ""),
            "بازه زمانی: " + (first.year || "در منبع سال دقیق ذکر شده است؛ در اسنیپت کوتاه ممکن است کامل نباشد"),
            "منبع: " + (first.sourceTitle || first.sourceUrl),
            found.stats.length > 1
              ? "نکته: در نتایج چند رقم دیده شد؛ ظرفیت اسمی را با تولید واقعی یکی نکنید."
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
      if (isWebRefusal(text) || /Sinox|grok-4|گروک|اینترنت زنده/i.test(text)) {
        text = finalizeText(formatShoppingFallback(found.hits, lastText));
      }
      return { text };
    }
    if (internalContext) {
      console.log("CHAT_ONCE", { deepen: false, web: false, tokens });
      return { text: await once() };
    }
    return { text: finalizeText(found.error) };
  }

  console.log("CHAT_ONCE", { deepen: false, web: false, tokens });
  let text = await once();
  if (
    !helpAsk &&
    !brief &&
    isFactualAsk(lastText) &&
    looksLikeForcedAnalysis(text)
  ) {
    console.log("CHAT_ONCE", { deepen: true, web: false, tokens });
    const direct = await once({ deepen: true });
    if (!looksLikeForcedAnalysis(direct) || countChatWords(direct) < countChatWords(text)) {
      text = direct;
    }
  } else if (allowDeepen && looksLikeShallowChat(text, lastText)) {
    console.log("CHAT_ONCE", { deepen: true, web: false, tokens });
    const deeper = await once({ deepen: true });
    if (
      !looksLikeShallowChat(deeper, lastText) ||
      countChatWords(deeper) > countChatWords(text)
    ) {
      text = deeper;
    }
  }

  return { text };
}

async function generateDocumentBody(
  apiKey: string,
  userText: string,
  kind: FileKind,
  extra = "",
  image = "",
  memoryPrompt = ""
) {
  const intent = detectDocumentIntent(userText);
  const job = intent.type === "job_profile" || isJobProfileRequest(userText);
  const fromSource = /محتوای فایل:|فایل خوانده شد|متن تصویر|متن استخراج‌شده از تصویر|محتوای اصلی برای تبدیل به پاورپوینت|متن فایل Word قبلی|دستور اصلاح کاربر:/.test(
    userText
  );
  const source =
    userText.length > 28000 ? userText.slice(0, 28000) : userText;
  const fallbackAsk =
    intent.type === "job_profile"
      ? "یک شناسنامه شغلی کامل فارسی با قالب منابع انسانی"
      : intent.type === "resume"
        ? "یک رزومه کامل برای بازار کار"
        : intent.type === "training"
          ? "یک جزوه آموزشی کامل و قابل تدریس"
          : intent.type === "project_charter"
            ? "یک شناسنامه پروژه کامل"
            : intent.type === "brief"
              ? "خلاصه مدیریتی همان منبع"
              : intent.type === "presentation" || kind === "pptx"
                ? "یک ارائه درباره همان موضوع درخواست"
                : intent.type === "performance"
                  ? "یک گزارش عملکرد سالانه"
                  : "یک سند کامل درباره همان موضوع درخواست کاربر";
  const writeNow =
    intent.type === "job_profile"
      ? "الان متن کامل شناسنامه شغلی را با ساختار بخش‌بندی‌شده بنویس. گزارش عملکرد، KPI شرکتی و روند درآمد ننویس."
      : intent.type === "resume"
        ? "الان رزومه را کامل بنویس. گزارش عملکرد سالانه سازمانی ممنوع است."
        : intent.type === "training"
          ? "الان جزوه آموزشی را کامل و قابل تدریس بنویس. گزارش عملکرد سالانه و جدول KPI سازمانی ممنوع است."
          : intent.type === "project_charter"
            ? "الان شناسنامه/منشور پروژه را کامل بنویس. گزارش عملکرد سالانه ممنوع است."
            : intent.type === "brief"
              ? "الان فقط خلاصه مدیریتی همان منبع را بنویس. جدول KPI ساختگی ممنوع است."
              : intent.type === "presentation" || kind === "pptx"
                ? [
                    "الان اسلایدها را فقط از منبع/موضوع واقعی بنویس.",
                    "قالب اجباری: هر اسلاید با خط SLIDE: عنوان",
                    "اسلاید کم‌متن: تیتر واضح و ۳ تا ۵ گلوله کوتاه از خود منبع.",
                    "اسلاید اول عنوان موضوع واقعی باشد (مثلاً CSCU) نه صفت کیفیت مثل قوی/خوشگل.",
                    "سرفصل کلی خالی مثل معرفی/مفاهیم/ابزارها بدون جمله منبع ممنوع است.",
                    "اگر محتوای مبدأ آمده، موضوع جدید نساز و از همان جمله‌ها گلوله بساز.",
                    "دستور کاربر و «فایل خوانده شد» روی اسلاید نیاید.",
                  ].join("\n")
                : intent.type === "performance"
                  ? "الان گزارش عملکرد را کامل با جدول شاخص بنویس."
                  : "الان خود سند را کامل از روی منبع/موضوع بنویس. قالب SAMPLE گزارش عملکرد سالانه، درآمد ساختگی و تحقق ۹۸٪ ممنوع است مگر منبع همان باشد.";
  const ask = [
    "درخواست کاربر:",
    source || fallbackAsk,
    "",
    extra,
    writeNow,
    "خروجی فقط متن سند است، نه پیام گفتگو.",
    image
      ? "اگر تصویر پیوست شده، متن فارسی داخل تصویر را هم بخوان و در سند استفاده کن. نگو نمی‌توانی عکس را بخوانی."
      : "",
    /متن از صفحات اسکن|این PDF اسکن است/.test(source)
      ? "اگر متن اسکن ناقص است، همان بخش خوانده‌شده (عنوان، موضوع، طرف قرارداد) را بنویس. همه فیلدها را با «قابل تشخیص نیست» پر نکن و عدد ساختگی نساز."
      : "",
    fromSource
      ? "حتماً از متن فایل یا تصویر استفاده کن و نمونه ساختگی نساز."
      : "کوتاه ننویس. تیتر alone ممنوع.",
  ]
    .filter(Boolean)
    .join("\n");

  let askText = ask;
  if (image && apiKey) {
    try {
      const ocr = await readImageDocument(apiKey, image);
      if (ocr.text && ocr.text.trim().length > 20) {
        askText += "\n\nمتن خوانده‌شده از تصویر:\n" + ocr.text.trim();
      }
    } catch {
      /* OCR optional */
    }
  }
  const messages = [
    {
      role: "system",
      content:
        documentSystemPrompt(kind, source) +
        (memoryPrompt ? "\n\n" + memoryPrompt : ""),
    },
    {
      role: "user",
      content: askText,
    },
  ];

  const generated = await callTextModel(messages, {
    temperature: job ? 0.25 : kind === "pptx" ? 0.3 : 0.45,
    max_tokens: job || intent.type === "training" || kind === "pptx" ? 10000 : 8000,
    fileText: true,
  });
  if (isModelErrorText(generated)) return "";
  return extractDocumentBody(generated);
}

function bilingualSourceDump(userText: string) {
  const raw = String(userText || "");
  const dump = raw
    .split(/محتوای فایل:|متن از صفحات اسکن‌شده:|متن فایل Word قبلی:/)
    .slice(1)
    .join("\n")
    .trim();
  return dump || raw;
}

function fallbackBilingual(source: string) {
  const paras = String(source || "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^--- صفحه \d+ ---\s*/m, "").trim())
    .filter((p) => p.length > 12);
  return paras
    .slice(0, 40)
    .map((p) => "EN: " + p + "\nFA: [در تصویر ناخوانا]")
    .join("\n\n");
}

async function generateBilingualDocument(
  apiKey: string,
  userText: string,
  memoryPrompt = ""
) {
  const source = bilingualSourceDump(userText).slice(0, 48000);
  const chunks = splitContractChunks(source);
  const parts: string[] = [];
  const system =
    bilingualDocumentPrompt() + (memoryPrompt ? "\n\n" + memoryPrompt : "");
  for (let i = 0; i < chunks.length; i += 1) {
    const generated = await callTextModel(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            i === 0
              ? "قرارداد اسکن‌شده را بندبه‌بند دوزبانه کن. از جلد، طرفین، موضوع و مواد شروع کن."
              : "ادامه همان قرارداد را دوزبانه کن. از جایی که قطع شد ادامه بده. قالب گزارش عملکرد ممنوع است.",
            "",
            chunks[i],
          ].join("\n"),
        },
      ],
      {
        temperature: 0.15,
        max_tokens: 8000,
        continueParts: 2,
        fileText: true,
      }
    );
    if (isModelErrorText(generated)) continue;
    const body = extractDocumentBody(generated);
    if (body) parts.push(body);
  }
  let out = parts.join("\n\n").trim();
  if (
    looksLikeManagementPerformanceReport(out) ||
    !looksLikeBilingualBody(out)
  ) {
    const retry = await callTextModel(
      [
        { role: "system", content: system },
        {
          role: "user",
          content:
            "فقط قالب EN: و FA: برای بندهای زیر. خلاصه مدیریتی و KPI ممنوع.\n\n" +
            source.slice(0, 12000),
        },
      ],
      { temperature: 0.1, max_tokens: 8000, continueParts: 2, fileText: true }
    );
    const body = extractDocumentBody(retry);
    if (looksLikeBilingualBody(body)) out = body;
  }
  if (!looksLikeBilingualBody(out)) {
    out = fallbackBilingual(source);
  }
  return out.replace(/\[نامشخص\]/g, "[در تصویر ناخوانا]");
}

async function completeText(
  apiKey: string,
  system: string,
  user: string,
  extra?: { temperature?: number; maxTokens?: number }
) {
  return extractDocumentBody(
    await callTextModel(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: extra?.temperature ?? 0.3,
        max_tokens: extra?.maxTokens ?? 8000,
        timeoutMs: 55000,
        fileText: true,
      }
    )
  );
}

async function extractPresentationBrief(apiKey: string, source: string) {
  const clipped = source.length > 32000 ? source.slice(0, 32000) : source;
  const facts = harvestSourceFacts(clipped);
  try {
    const brief = await completeText(
      apiKey,
      sourceBriefPrompt(),
      [
        "متن منبع:",
        clipped,
        facts ? "\nشواهد الزامی که باید در خلاصه بمانند:\n" + facts : "",
        "الان خلاصه ساخت‌یافته را بنویس.",
      ]
        .filter(Boolean)
        .join("\n"),
      { temperature: 0.15, maxTokens: 4000 }
    );
    if (brief && brief.length > 250) return brief;
  } catch {
    /* fall through to harvested facts */
  }
  return facts
    ? "شواهد استخراج‌شده از فایل:\n" + facts
    : clipped.slice(0, 12000);
}

async function makePresentationScript(apiKey: string, userText: string) {
  const fromFile = looksLikeProposalSource(userText);
  const source =
    userText.length > 36000 ? userText.slice(0, 36000) : userText;
  const facts = harvestSourceFacts(source);

  let brief = "";
  if (fromFile && hasAttachedSource(source)) {
    brief = await extractPresentationBrief(apiKey, source);
  }

  async function generate(extra = "") {
    const sourceWindow =
      fromFile && brief.length > 800 ? 2800 : fromFile ? 14000 : 8000;
    const payload = [
      "درخواست کاربر:",
      source.slice(0, sourceWindow),
      brief ? "\nخلاصه استخراج‌شده از فایل (منبع اصلی):\n" + brief : "",
      facts && fromFile ? "\nشواهد مستقیم فایل:\n" + facts : "",
      extra,
      "الان متن ارائه غنی و تصمیم‌پذیر را در ۱۲ اسلاید با قالب اجباری هر اسلاید بنویس.",
      "سرعنوان‌ها با رقم انگلیسی باشد: اسلاید 1: تا اسلاید 12:.",
      "هر ۱۲ اسلاید را کامل بنویس و برای هر کدام نکته سخنرانی تحلیلی بگذار.",
      "اسلایدها را با مصداق، خروجی، عدد و اقدام پر کن؛ خلاصه کلی ننویس.",
    ]
      .filter(Boolean)
      .join("\n");

    return completeText(
      apiKey,
      presentationScriptPrompt(source),
      payload,
      { temperature: 0.22, maxTokens: 6000 }
    );
  }

  let script = "";
  try {
    script = await generate();
    const quality = presentationScriptQuality(script, source);
    if (!quality.ok) {
      script = await generate(retryInstruction(quality.issues, fromFile));
    }
  } catch {
    script = "";
  }

  const finalQuality = presentationScriptQuality(script, source);
  if (finalQuality.slideCount < 6) {
    return {
      text: fromFile
        ? "متن فایل برای ساخت ارائه کافی نبود. لطفاً فایل کامل‌تری بفرست."
        : "ساخت متن ارائه انجام نشد. دوباره تلاش کنید.",
    };
  }

  try {
    const file = await buildPresentationScriptDoc(script, userText);
    const stored = persistOutputFile(file);
    if (!stored.url) {
      return { text: script || "ساخت فایل Word انجام نشد: ذخیره روی دیسک ناموفق بود." };
    }
    return {
      text: "فایل شما آماده شد.",
      file: { name: stored.name, url: stored.url, mime: stored.mime },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "خطای ناشناخته";
    return {
      text: script || "ساخت فایل Word انجام نشد: " + message,
    };
  }
}

function slideImagePrompt(
  title: string,
  bullets: string[],
  sourceText: string
) {
  const industrial = isIndustrialImageTopic(sourceText);
  return [
    "Clean educational infographic illustration, no text, no captions, no watermarks.",
    "Subject: " + title + ".",
    bullets[0] ? "Detail: " + bullets[0].slice(0, 120) : "",
    industrial
      ? ""
      : "Do not show steel mill, factory, mining plant, or industrial furnace.",
    "Simple, professional, suitable for a presentation slide.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function makePptxDeck(opts: {
  userAsk: string;
  sourceText: string;
  memoryPrompt?: string;
  topicHint?: string;
  avalaiKey?: string;
}) {
  let sourceText = (opts.sourceText || "").trim();
  if (sourceText.length < 40) {
    const ask = (opts.userAsk || "").trim();
    if (ask.length > 40) sourceText = ask;
  }
  if (sourceText.length < 40) {
    return {
      text: "منبع برای ساخت ارائه کافی نیست. فایل یا متن سند را بفرستید.",
    };
  }
  const planned = await generateSlidePlan(sourceText);
  let plan: SlidePlan | null = planned === "quota" ? null : planned;
  if (planned === "quota" || !plan || !plan.slides.length) {
    plan = fallbackPlanFromSource(sourceText);
    console.log("PPT_FALLBACK", {
      sourceChars: sourceText.length,
      title: plan.title,
      slides: plan.slides.length,
    });
  }
  if (
    !plan.slides.length ||
    looksLikeBadPptFirstSlide(plan.slides[0]?.title || plan.title)
  ) {
    return {
      text: "طرح اسلاید از مدل دریافت نشد. لطفاً دوباره تلاش کنید.",
    };
  }
  console.log("PPT_PIPELINE", {
    sourceChars: sourceText.length,
    title: plan.title,
    slides: plan.slides.length,
  });
  const intent = detectDocumentIntent(
    (opts.userAsk || "") + "\n" + sourceText
  );
  const visual = wantsVisualPptx(opts.userAsk || "");
  let imgPlanned = 0;
  let imgGenerated = 0;
  let imgEmbedded = 0;
  if (visual && opts.avalaiKey) {
    const targets = plan.slides.slice(0, 6);
    imgPlanned = targets.length;
    const results = await Promise.allSettled(
      targets.map((slide) =>
        generateImage(
          opts.avalaiKey || "",
          slideImagePrompt(slide.title, slide.bullets, sourceText)
        )
      )
    );
    results.forEach((result, i) => {
      if (result.status !== "fulfilled" || !result.value.image) return;
      imgGenerated += 1;
      const disk = mediaDiskPath(result.value.image);
      if (disk && existsSync(disk)) {
        targets[i].imagePath = disk;
        imgEmbedded += 1;
      }
    });
  }
  console.log("PPT_IMAGES", {
    planned: imgPlanned,
    generated: imgGenerated,
    embedded: imgEmbedded,
  });
  const base =
    intent.fileName?.replace(/\.pptx$/i, "") ||
    "ارائه-" +
      brandForAsk(plan.title || opts.topicHint || "موضوع", opts.userAsk || opts.topicHint || "").slice(0, 40);
  const rtl = !isEnglishDocument(
    [plan.title, plan.subtitle, ...plan.slides.map((s) => s.title)].join("\n"),
    opts.userAsk || sourceText
  );
  const built = await makeProfessionalPptx({
    title: brandForAsk(plan.title, opts.userAsk || opts.topicHint || ""),
    subtitle: brandForAsk(plan.subtitle || "", opts.userAsk || ""),
    slides: plan.slides.map((s) => ({
      ...s,
      title: brandForAsk(s.title, opts.userAsk || ""),
      bullets: (s.bullets || []).map((b) => brandForAsk(b, opts.userAsk || "")),
    })),
    fileBaseName: base,
    topic: brandForAsk(plan.title, opts.userAsk || ""),
    rtl,
    audience: detectDocumentIntent(opts.userAsk || opts.topicHint || "").audience,
  });
  const stored = persistOutputFile({
    fileName: built.fileName,
    fileBase64: built.fileBase64,
    fileMime: built.fileMime,
    kind: "pptx",
  });
  if (!stored.url || stored.url.startsWith("data:")) {
    return { text: "ساخت فایل انجام نشد: ذخیره روی دیسک ناموفق بود." };
  }
  return {
    text: "فایل شما آماده شد.",
    file: { name: stored.name, url: stored.url, mime: stored.mime },
  };
}

async function makeDocument(
  apiKey: string,
  userText: string,
  kind: FileKind,
  image = "",
  memoryPrompt = ""
) {
  const intent = detectDocumentIntent(userText);
  console.log("DOC_INTENT", {
    type: intent.type,
    topic: intent.topic,
    fileName: intent.fileName,
    source: sourceTextOnly(userText).length > 40 ? "file" : "none",
  });
  const outKind = intent.kind || kind;
  const fromFile =
    /محتوای فایل:|فایل خوانده شد|متن تصویر|پروپوزال|محتوای اصلی برای تبدیل به پاورپوینت/.test(
      userText
    ) || !!image;
  const job = intent.type === "job_profile" || isJobProfileRequest(userText);
  const bilingual = intent.type === "translation" || isBilingualAsk(userText);
  if (outKind === "pptx") {
    return makePptxDeck({
      userAsk: userAskOnly(userText),
      sourceText: sourceTextOnly(userText),
      memoryPrompt,
      topicHint: intent.topic,
      avalaiKey: apiKey,
    });
  }
  let body = "";
  try {
    if (bilingual) {
      body = await generateBilingualDocument(apiKey, userText, memoryPrompt);
    } else {
    body = await generateDocumentBody(
      apiKey,
      userText,
      outKind,
      "",
      image,
      memoryPrompt
    );
    if (
      looksLikeChatNotDocument(body, outKind, userText) ||
      (fromFile && body.length < 80)
    ) {
      const retryExtra =
        intent.type === "job_profile"
          ? "حتماً عنوان سند «شناسنامه شغلی» باشد. ساختار منابع انسانی را کامل بنویس. گزارش عملکرد سالانه ممنوع است."
          : intent.type === "resume"
            ? "رزومه کامل بنویس. گزارش عملکرد سالانه سازمانی ممنوع است."
            : intent.type === "training"
              ? "جزوه آموزشی کامل بنویس: اهداف، سرفصل، شرح، مثال، تمرین. گزارش عملکرد و KPI سازمانی ممنوع است."
              : intent.type === "project_charter"
                ? "شناسنامه پروژه کامل بنویس. گزارش عملکرد سالانه ممنوع است."
                : intent.type === "brief"
                  ? "فقط خلاصه مدیریتی همان منبع. جدول KPI ساختگی ممنوع."
                  : fromFile
                    ? "فقط از متن فایل یا تصویر استفاده کن. SAMPLE عملکرد سالانه، درآمد ساختگی و تحقق ۹۸٪ ممنوع است مگر منبع همان باشد."
                    : intent.type === "performance"
                        ? "حتماً خلاصه مدیریتی، TABLE شاخص‌ها با عدد و واحد، تحلیل روند، ریسک و اقدامات اولویت‌دار بنویس."
                        : "سند را کامل درباره همان موضوع بنویس. قالب گزارش عملکرد سالانه ممنوع است مگر type واقعاً performance باشد.";
      body = await generateDocumentBody(
        apiKey,
        userText,
        outKind,
        retryExtra,
        image,
        memoryPrompt
      );
    }
    }
  } catch {
    body = "";
  }

  if (bilingual && looksLikeManagementPerformanceReport(body)) {
    body = await generateBilingualDocument(apiKey, userText, memoryPrompt);
  }

  if (
    intent.type === "performance" &&
    !fromFile &&
    looksLikeChatNotDocument(body, outKind, userText)
  ) {
    body = SAMPLE.word;
  }

  if (job && looksLikeManagementPerformanceReport(body)) {
    body = JOB_PROFILE_SAMPLE;
  }

  if (
    intent.type !== "performance" &&
    looksLikeManagementPerformanceReport(body)
  ) {
    body = "";
  }

  if (isModelErrorText(body)) {
    console.log("DOCUMENT_BODY_ERROR", body.slice(0, 500));
    return {
      text: "ساخت سند انجام نشد. لطفاً دوباره تلاش کنید.",
    };
  }

  const refuse =
    /امکان ایجاد پیوست|لینک قابل دانلود نخواهد بود|فایل باینری در دسترس نیست|پیوست در دسترس نیست|نمی‌توانم.{0,24}(?:فایل|پیوست)/;
  if (refuse.test(body) && fromFile && !bilingual) {
    const dump = String(userText || "")
      .split(/محتوای فایل:|متن فایل Word قبلی:/)
      .slice(1)
      .join("\n")
      .trim();
    if (dump.length > 40) body = dump.slice(0, 25000);
  }

  if (fromFile && (!body || body.length < 40 || refuse.test(body))) {
    return {
      text: "متن فایل خوانده شد اما برای ساخت خروجی کافی نبود. لطفاً فایل متنی‌تری بفرست.",
    };
  }

  if (!body || body.length < 40) {
    return {
      text: "ساخت سند انجام نشد. لطفاً دوباره تلاش کنید.",
    };
  }

  try {
    const file = await buildOfficeFile(outKind, brandForAsk(body, userText), userText);
    const named = detectDocumentIntent(userText, body);
    if (named.fileName) file.fileName = named.fileName;
    if (
      /دستور اصلاح کاربر:|دوباره\s*بساز|لینک\s*دانلود|اصلاح[‌\s]*شده/.test(
        userText
      ) &&
      file.fileName
    ) {
      file.fileName = String(file.fileName).replace(
        /(\.[a-z0-9]+)$/i,
        "-" + Date.now() + "$1"
      );
    }
    const stored = persistOutputFile({ ...file, kind: outKind });
    if (!stored.url || stored.url.startsWith("data:")) {
      return { text: "ساخت فایل انجام نشد: ذخیره روی دیسک ناموفق بود." };
    }
    if (bilingual) {
      const extracted = bilingualSourceDump(userText);
      console.log("BILINGUAL_WORD", {
        chars: extracted.length,
        url: stored.url,
      });
    }
    const text = "فایل شما آماده شد.";
    return {
      text,
      file: {
        name: stored.name,
        url: stored.url,
        mime: stored.mime,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "خطای ناشناخته";
    return {
      text: "ساخت فایل انجام نشد: " + message,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    return await runUsage(async () => {
    const body = await req.json();
    const messages: IncomingMessage[] = Array.isArray(body.messages)
      ? body.messages
      : [];
    const textClient = getTextClient();
    const avalai = getAvalaiClient();
    const apiKey = avalai?.apiKey || "";
    const username = canonUsername(
      req.headers.get("x-cpgai-user") || String(body.username || "")
    );
    let unreadFiles: string[] = [];
    function withUnreadNote<T extends { text?: string }>(payload: T): T {
      if (!unreadFiles.length) return payload;
      const note = "این فایل‌ها خوانده نشد: " + unreadFiles.join("، ") + ".";
      const t = String(payload.text || "");
      if (!t || t.includes(note)) return payload;
      return { ...payload, text: t.trimEnd() + "\n" + note };
    }
    function respond(payload: object, init?: { status: number }) {
      const next = withUnreadNote(payload as { text?: string });
      if (!init || init.status === 200) {
        try {
          logUsageIfSuccess(username, next);
        } catch (err) {
          console.log("USAGE_LOG_FAIL", err);
        }
      }
      return NextResponse.json(next, init);
    }

    if (!textClient) {
      return NextResponse.json(
        { error: "کلید متن تنظیم نشده است. SINOX_API_KEY یا GAPGPT_API_KEY یا AVALAI_API_KEY را در .env.local بگذارید." },
        { status: 500 }
      );
    }

    for (const msg of messages) {
      const rawImgs = collectMessageImages(msg);
      const converted: string[] = [];
      for (const src of rawImgs) {
        try {
          converted.push(
            isPublicMediaPath(src) ? await toModelImage(src) : src
          );
        } catch (err) {
          console.log("TO_MODEL_IMAGE_FAIL", err);
          converted.push(src);
        }
      }
      if (converted[0]) msg.image = converted[0];
      if (converted.length) msg.images = converted;
    }

    const last = messages[messages.length - 1] || {};
    let lastText = last.content || "";
    if (Array.isArray(last.files) && last.files.length) {
      const packed = packFileSources(last.files);
      unreadFiles = packed.failed;
      console.log("FILES_READ", {
        count: packed.count,
        names: packed.names,
        charsEach: packed.charsEach,
        failed: packed.failed,
      });
      const ask =
        userAskOnly(lastText).trim() ||
        (packed.count > 1
          ? "این فایل‌ها را بررسی کن."
          : "این فایل را بررسی کن.");
      lastText = packed.dump
        ? ask + "\n\nمحتوای فایل:\n" + packed.dump
        : ask;
      if (packed.failed.length) {
        lastText +=
          "\n\nاین فایل‌ها خوانده نشد: " + packed.failed.join("، ") + ".";
      }
      last.content = lastText;
    }
    const lastImagesNow = collectMessageImages(last);
    const memories = listMemories(username);
    const memoryPrompt = formatMemoryPrompt(memories);
    const explicitFileOutput = wantsFileOutput(userAskOnly(lastText));
    const memKind = explicitFileOutput ? memoryPreferredKind(memories, lastText) : null;
    const savedMemory = username
      ? !!captureTeachMemory(username, lastText)
      : false;
    const SAVED_LINE = "این مورد برای چت‌های بعد ذخیره شد.";


    const attachSavedLine = <T extends { text?: string }>(result: T): T => {
      if (!savedMemory) return result;
      const body = String(result.text || "");
      if (body.trim() === "فایل شما آماده شد.") return result;
      if (!body) return { ...result, text: SAVED_LINE };
      if (body.startsWith(SAVED_LINE)) return result;
      return { ...result, text: SAVED_LINE + "\n" + body };
    };

    console.log("MEMORY_INJECT", memories.slice(0, 7).length, {
      saved: savedMemory,
      memKind,
    });
    if (isMemoryOnlyAsk(lastText)) {
      return respond({
        text: savedMemory
          ? SAVED_LINE
          : "این مورد ذخیره نشد.",
      });
    }

    if (isChartAsk(lastText) || isChartExcelAsk(lastText)) {
      try {
        const ctxParts: string[] = [];
        for (let i = messages.length - 1; i >= 0 && ctxParts.join("\n").length < 12000; i -= 1) {
          const m = messages[i];
          const c = String(m.content || "").trim();
          if (c) ctxParts.push((m.role || "user") + ": " + c.slice(0, 3000));
        }
        const spec = await buildChartSpecFromChat(lastText, ctxParts.join("\n\n"));
        if (spec) {
          if (isChartExcelAsk(lastText)) {
            const built = await buildChartExcel(spec);
            const stored = persistOutputFile(built);
            if (!stored.url) {
              return respond({
                text: "ساخت فایل اکسل نمودار انجام نشد: ذخیره روی دیسک ناموفق بود.",
              });
            }
            console.log("CHART_EXCEL", { title: spec.title, url: stored.url });
            return respond({
              text:
                "فایل اکسل نمودار آماده شد. برگه «داده نمودار» قابل ویرایش است؛ پیش‌نمایش تصویر هم داخل فایل هست.",
              file: { name: stored.name, url: stored.url, mime: stored.mime },
              fileName: stored.fileName || stored.name,
              fileUrl: stored.fileUrl || stored.url,
              fileMime: stored.fileMime || stored.mime,
            });
          }
          const png = await renderChartPng(spec);
          const url = writeGeneratedPng(png);
          console.log("CHART_RENDERED", { type: spec.type, title: spec.title, url });
          return respond({
            text:
              "نمودار آماده شد" +
              (spec.title ? ": " + spec.title : ".") +
              (spec.note ? "\n" + spec.note : ""),
            image: url,
          });
        }
        console.log("CHART_SPEC_EMPTY");
      } catch (err) {
        console.log("CHART_RENDER_FAIL", err);
        return respond({
          text:
            "ساخت نمودار انجام نشد: " +
            errMessage(err).slice(0, 220) +
            " اگر داده عددی در گفتگو هست دوباره بپرسید.",
        });
      }
    }

    function streamChat(runMessages: IncomingMessage[]) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: object) => {
            controller.enqueue(
              encoder.encode("data: " + JSON.stringify(obj) + "\n\n")
            );
          };
          let full = "";
          try {
            if (savedMemory) {
              const line = SAVED_LINE + "\n";
              full += line;
              send({ text: line });
            }
            const result = await chatText(
              apiKey,
              runMessages,
              memoryPrompt,
              (chunk) => {
                full += chunk;
                send({ text: chunk });
              },
              (status) => send({ status })
            );
            let finalText = String(result.text || "");
            if (savedMemory) {
              if (!finalText) finalText = SAVED_LINE;
              else if (!finalText.startsWith(SAVED_LINE))
                finalText = SAVED_LINE + "\n" + finalText;
            }
            if (finalText && !full) {
              await emitTextLive(finalText, (chunk) => {
                full += chunk;
                send({ text: chunk });
              });
            } else if (
              finalText.startsWith(full) &&
              finalText.length > full.length
            ) {
              const rest = finalText.slice(full.length);
              await emitTextLive(rest, (chunk) => {
                full += chunk;
                send({ text: chunk });
              });
            }
            const payload = withUnreadNote({ text: finalText || full });
            try {
              logUsageIfSuccess(username, payload);
            } catch (err) {
              console.log("USAGE_LOG_FAIL", err);
            }
            send({ done: true, text: payload.text });
          } catch (err) {
            const msg =
              "پردازش پیام انجام نشد. " + errMessage(err).slice(0, 180);
            send({ text: msg, done: true });
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    let workSource = resolveWorkSource(messages, lastText);
    if (
      workSource.kind === "chat" &&
      explicitFileOutput &&
      !sourceTextOnly(lastText) &&
      (wantsFileOutput(lastText) ||
        isPptxAsk(lastText) ||
        wantsPptx(lastText) ||
        isForcedWordAsk(lastText) ||
        isDocReviseAsk(lastText))
    ) {
      lastText =
        userAskOnly(lastText) + "\n\nمحتوای فایل:\n" + workSource.text;
      last.content = lastText;
      messages[messages.length - 1] = { ...last, content: lastText };
    }
    let docIntent = detectDocumentIntent(lastText);
    console.log("DOC_INTENT", {
      type: docIntent.type,
      topic: docIntent.topic,
      fileName: docIntent.fileName,
      source: workSource.kind,
    });
    const resumeAsk = findResumeImageAsk(messages);
    const forceWord = explicitFileOutput && (isForcedWordAsk(lastText) || isBilingualAsk(lastText));
    const reviseAsk = explicitFileOutput && isDocReviseAsk(lastText);
    const pptAsk =
      explicitFileOutput && (docIntent.type === "presentation" ||
      docIntent.format === "pptx" ||
      wantsPptx(lastText) ||
      isPptxAsk(lastText));
    const fileByIntent =
      docIntent.format === "pdf" ||
      docIntent.format === "docx" ||
      docIntent.format === "pptx" ||
      docIntent.format === "xlsx" ||
      (docIntent.type !== "chat" && docIntent.type !== "image");
    const imageByIntent =
      docIntent.type === "image" || docIntent.format === "image";
    const hasAttachedImage =
      lastImagesNow.length > 0 || !!findLastAnyImage(messages);
    const generateAsk =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      !isImageEditAsk(lastText, hasAttachedImage) &&
      (imageByIntent || isImageGenerateAsk(lastText) || !!resumeAsk);
    const editAsk =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      isImageEditAsk(lastText, hasAttachedImage);
    const imageWork =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      (imageByIntent ||
        generateAsk ||
        editAsk ||
        isImageWorkAsk(lastText, messages));
    const refersToImage =
      /از روی این|این تصویر|این عکس|متن تصویر|تصویر را|عکس را|این لوگو|لوگو را|ببین/.test(
        lastText
      ) || lastImagesNow.length > 0;
    const lastImage =
      lastImagesNow[0] ||
      (imageWork || refersToImage ? findLastAnyImage(messages) : "") ||
      (refersToImage ? findLastUserImage(messages) : "");
    console.log("IMAGE_GATE", {
      lastImage: !!lastImage,
      generate: generateAsk && !editAsk,
      edit: editAsk && !!lastImage,
    });
    const documentWork = explicitFileOutput && (isDocumentWorkRequest(lastText) || fileByIntent) && !imageWork;
    const fileKindEarly = explicitFileOutput ? detectFileKind(lastText) : null;
    const quota = username ? await getQuota(username) : null;
    function limitText(kind: "image" | "file" | "chat", extra = 1) {
      if (!quota) return null;
      return quotaMessage(kind, quota, extra);
    }
    let ocrNote = "";
    let sourceImage = "";
    let ocrKind: "document" | "scene" | "unknown" | "" = "";

    if (imageWork) {
      const imageCount = resumeAsk
        ? resumeImageCount(resumeAsk)
        : Math.min(5, requestedImageCount(lastText) || 1);
      const imageAdd = editAsk && !generateAsk ? 1 : imageCount;
      const imageBlocked = limitText("image", imageAdd);
      if (imageBlocked) {
        return respond({ text: imageBlocked });
      }
      try {
        if (!apiKey) {
          return respond({
            text: "کلید AvalAI برای ساخت تصویر تنظیم نشده است.",
          });
        }
        const uploadedNow = lastImagesNow.length > 0;
        const historyImage = findLastAnyImage(messages);
        const userLogos = findLastUserImages(messages);
        if (resumeAsk) {
          const count = resumeImageCount(resumeAsk);
          const logoSrc = shouldStampLogo(resumeAsk, messages)
            ? lastImagesNow[0] || userLogos[0] || historyImage || ""
            : "";
          console.log("IMAGE_RESUME", {
            fromHistory: true,
            lastUser: resumeAsk.slice(0, 80),
            hasLogo: !!logoSrc,
          });
          console.log("IMAGE_MULTI", {
            count,
            hasLastImage: !!logoSrc || !!historyImage,
            path: "generate",
          });
          return respond(
            await generateImageSet(apiKey, resumeAsk, count, logoSrc, messages)
          );
        }
        const executePrompt =
          /پرامپت|همین (?:را|رو) بساز|همین طرح|اجرا کن|رندر/.test(lastText) &&
          !isCompositeImageAsk(lastText) &&
          lastImagesNow.length < 2;
        const source = lastImagesNow[0] || historyImage;
        const shouldEdit =
          (!!source &&
            (editAsk ||
              isCompositeImageAsk(lastText) ||
              isShowImageAgainAsk(lastText) ||
              (lastImagesNow.length > 1 &&
                /درست کن|بساز|ویرایش|لباس|بک|کارت|استفاده کن/.test(lastText)))) &&
          !(executePrompt && !isCompositeImageAsk(lastText));
        const count = shouldEdit
          ? 1
          : Math.min(
              5,
              requestedImageCount(resumeAsk || lastText) || 1
            );
        const logoSrc = shouldStampLogo(lastText, messages)
          ? lastImagesNow[0] || userLogos[0] || historyImage || ""
          : "";
        const path = shouldEdit ? "edit" : "generate";
        console.log("IMAGE_MULTI", {
          count,
          hasLastImage: !!lastImage || !!source || uploadedNow,
          path,
        });
        console.log("IMAGE_PATH", path, lastText.slice(0, 80));
        console.log(
          "CHAT_PROVIDER",
          "avalai",
          shouldEdit ? "image-edit" : "image-generate"
        );
        if (shouldEdit) {
          const refs = [
            ...lastImagesNow,
            ...(historyImage && !lastImagesNow.includes(historyImage)
              ? [historyImage]
              : []),
          ].filter(Boolean);
          const uniqueRefs = [...new Set(refs)];
          const composite =
            isCompositeImageAsk(lastText) || uniqueRefs.length > 1;
          // Prefer first attached as base; for retries use latest result.
          let editSource =
            isEditRetryAsk(lastText) && historyImage
              ? historyImage
              : source || uniqueRefs[0] || "";
          // If composing a card with a person photo, prefer a non-card-looking early attach
          // but always send ALL refs so the model can take the face from the boy photo.
          const extra = uniqueRefs.filter((u) => u !== editSource).slice(0, 5);
          if (logoSrc && logoSrc !== editSource && !extra.includes(logoSrc)) {
            extra.push(logoSrc);
          }
          let edited;
          if (composite) {
            const prompt = collectCompositeEditPrompt(
              lastText,
              uniqueRefs.length
            );
            console.log("IMAGE_COMPOSITE", {
              refs: uniqueRefs.length,
              extra: extra.length,
            });
            edited = await editImage(
              apiKey,
              editSource,
              prompt,
              true,
              extra
            );
          } else {
            edited = await editImageWithTextSwapRetries(
              apiKey,
              editSource || source,
              lastText,
              extra,
              body.messages
            );
          }
          if (edited.image) {
            return respond(edited);
          }
          // Never fall back to text-to-image for an edit ask — that creates a new unrelated picture.
          return respond({
            text:
              edited.text ||
              "ویرایش عکس انجام نشد. عکس جدید نساختم تا طرح اصلی خراب نشود. دوباره امتحان کنید.",
          });
        }
        return respond(
          await generateImageSet(apiKey, lastText, count, logoSrc, messages)
        );
      } catch (err) {
        console.log("CHAT_POST_ERROR", err);
        return respond({
          text: "ساخت تصویر انجام نشد. " + errMessage(err).slice(0, 180),
        });
      }
    }

    const visionImages =
      lastImagesNow.length > 0
        ? lastImagesNow.slice(0, 8)
        : findLastUserImages(messages).slice(0, 8);
    const fileDumpWeak =
      /این PDF اسکن است و متن صفحه کافی استخراج نشد|بخشی از متن فایل خوانا نبود/.test(
        lastText
      );
    if (visionImages.length && documentWork && apiKey) {
      const pages: string[] = [];
      let anyUnclear = "";
      for (const img of visionImages) {
        const ocr = await readImageDocument(apiKey, img);
        if (ocr.text.trim().length >= 20) pages.push(ocr.text.trim());
        if (ocr.unclear) anyUnclear = ocr.unclear;
        if (!ocrKind) ocrKind = ocr.kind;
        if (ocr.kind === "document") ocrKind = "document";
      }
      const merged = pages.join("\n\n");
      if (merged.length >= 20) {
        lastText = attachImageSource(lastText, merged, anyUnclear);
        messages[messages.length - 1] = { ...last, content: lastText };
        sourceImage = visionImages[0] || lastImage;
        ocrNote = anyUnclear
          ? "متن تصویر خوانده شد. برخی بخش‌ها نامشخص بود. "
          : "متن تصویر خوانده شد. ";
      } else if (ocrKind !== "scene") {
        sourceImage = visionImages[0] || lastImage || "";
        ocrNote = fileDumpWeak
          ? "این PDF اسکن است و متن صفحه کافی استخراج نشد. "
          : "متن تصویر خوانده شد. ";
      }
    } else if (fileDumpWeak && documentWork) {
      ocrNote = "این PDF اسکن است و متن صفحه کافی استخراج نشد. ";
    }

    function withOcrNote<T extends { text?: string }>(result: T): T {
      if (!ocrNote) return result;
      if ((result.text || "").trim() === "فایل شما آماده شد.") return result;
      return { ...result, text: ocrNote + (result.text || "") };
    }

    if (docIntent.convertSame) {
      const prev = await collectConvertSource(messages, lastText);
      if (prev.trim().length > 40) {
        lastText =
          userAskOnly(lastText) + "\n\nمحتوای فایل:\n" + prev.slice(0, 28000);
        last.content = lastText;
        messages[messages.length - 1] = { ...last, content: lastText };
        docIntent = detectDocumentIntent(lastText);
        if (workSource.kind !== "file") {
          workSource = {
            text: prev,
            kind: lastUserFileDump(messages) ? "file" : "chat",
          };
        }
        console.log("DOC_INTENT", {
          type: docIntent.type,
          topic: docIntent.topic,
          fileName: docIntent.fileName,
          source: workSource.kind,
        });
      }
    }

    if (forceWord || reviseAsk) {
      if (forceWord) {
        console.log("FORCE_WORD", true, lastText.slice(0, 100));
      }
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      const source =
        /محتوای فایل:|متن فایل Word قبلی:/.test(lastText) || !reviseAsk
          ? lastText
          : await buildWordReviseSource(messages, lastText);
      const made = await makeDocument(
        apiKey,
        source,
        "word",
        sourceImage,
        memoryPrompt
      );
      const ready =
        !!made.file?.url && !String(made.file.url).startsWith("data:");
      const payload = storedOfficePayload({
        ...made,
        text: ready
          ? "فایل شما آماده شد."
          : made.text,
      });
      console.log(forceWord ? "FORCE_WORD" : "DOC_REVISE", {
        kind: "word",
        url: payload.file?.url || "",
      });
      return respond(attachSavedLine(withOcrNote(payload)));
    }

    if (
      docIntent.convertSame &&
      docIntent.format !== "chat" &&
      docIntent.format !== "image"
    ) {
      const source = sourceTextOnly(lastText);
      if (source.trim().length < 40) {
        return respond({
          text: "سند قبلی برای تبدیل پیدا نشد. همان فایل را بفرستید.",
        });
      }
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      if (docIntent.format === "pptx" || docIntent.type === "presentation") {
        return respond(
          attachSavedLine(
            withOcrNote(
              await makePptxDeck({
                userAsk: userAskOnly(lastText),
                sourceText: source,
                memoryPrompt,
                topicHint: docIntent.topic,
                avalaiKey: apiKey,
              })
            )
          )
        );
      }
      const kind = docIntent.kind || "word";
      const built = await buildOfficeFile(kind, brandForAsk(source, lastText), lastText);
      if (docIntent.fileName) built.fileName = docIntent.fileName;
      const stored = persistOutputFile({ ...built, kind });
      const ready = !!stored.url && !String(stored.url).startsWith("data:");
      const text = !ready
        ? "ساخت فایل انجام نشد: ذخیره روی دیسک ناموفق بود."
        : "فایل شما آماده شد.";
      return respond(
        attachSavedLine(
          withOcrNote({
            text,
            file: ready
              ? { name: stored.name, url: stored.url, mime: stored.mime }
              : undefined,
          })
        )
      );
    }

    if (explicitFileOutput && (docIntent.type === "job_profile" || isJobProfileRequest(lastText))) {
      if (
        lastImage &&
        ocrKind === "scene" &&
        !/محتوای فایل:|متن تصویر/.test(lastText)
      ) {
        const chatBlocked = limitText("chat");
        if (chatBlocked) return respond({ text: chatBlocked });
        return streamChat(messages);
      }
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      if (pptAsk && memKind !== "word") {
        return respond(
          attachSavedLine(
            withOcrNote(
              await makePptxDeck({
                userAsk: userAskOnly(lastText),
                sourceText: collectPptSourceText(messages, lastText),
                memoryPrompt,
                topicHint: docIntent.topic,
                avalaiKey: apiKey,
              })
            )
          )
        );
      }
      const kind =
        docIntent.format === "pdf"
          ? "pdf"
          : docIntent.format === "xlsx"
            ? "xlsx"
            : memKind || detectFileKind(lastText) || "word";
      return respond(
        attachSavedLine(
          withOcrNote(
            await makeDocument(apiKey, lastText, kind, sourceImage, memoryPrompt)
          )
        )
      );
    }

    if (pptAsk) {
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      console.log("DOC_KIND", "pptx", {
        same: wantsSameContent(lastText) || docIntent.convertSame,
      });
      return respond(
        attachSavedLine(
          withOcrNote(
            await makePptxDeck({
              userAsk: userAskOnly(lastText),
              sourceText: collectPptSourceText(messages, lastText),
              memoryPrompt,
              topicHint: docIntent.topic,
              avalaiKey: apiKey,
            })
          )
        )
      );
    }

    const fileKind =
      docIntent.format === "pdf"
        ? "pdf"
        : docIntent.format === "pptx"
          ? "pptx"
          : docIntent.format === "xlsx"
            ? "xlsx"
            : docIntent.format === "docx"
              ? "word"
              : memKind || fileKindEarly;

    // A presentation script stays in chat unless a file was explicitly requested.
    if (
      explicitFileOutput &&
      isPresentationScriptRequest(lastText) &&
      fileKind !== "pptx" &&
      fileKind !== "xlsx" &&
      fileKind !== "pdf"
    ) {
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      const scriptInput = collectPresentationInput(messages);
      return respond(
        attachSavedLine(
          withOcrNote(await makePresentationScript(apiKey, scriptInput))
        )
      );
    }

    if (fileKind === "pptx") {
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      return respond(
        attachSavedLine(
          withOcrNote(
            await makePptxDeck({
              userAsk: userAskOnly(lastText),
              sourceText: collectPptSourceText(messages, lastText),
              memoryPrompt,
              topicHint: docIntent.topic,
              avalaiKey: apiKey,
            })
          )
        )
      );
    }

    if (fileKind) {
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      return respond(
        attachSavedLine(
          withOcrNote(
            await makeDocument(
              apiKey,
              lastText,
              fileKind,
              sourceImage,
              memoryPrompt
            )
          )
        )
      );
    }

    if (editAsk && lastImage && !documentWork) {
      const imageBlocked = limitText("image", 1);
      if (imageBlocked) return respond({ text: imageBlocked });
      if (!apiKey) {
        return respond({
          text: "کلید AvalAI برای ویرایش تصویر تنظیم نشده است.",
        });
      }
      console.log("IMAGE_GATE", {
        lastImage: true,
        generate: false,
        edit: true,
      });
      console.log("IMAGE_PATH", "edit", lastText.slice(0, 80));
      console.log("CHAT_PROVIDER", "avalai", "image-edit");
      return respond(await editImage(apiKey, lastImage, lastText));
    }

    if (isImageGenerateAsk(lastText) || resumeAsk) {
      const askText = resumeAsk || lastText;
      const count = Math.min(5, resumeAsk ? resumeImageCount(askText) : requestedImageCount(askText) || 1);
      const imageBlocked = limitText("image", count);
      if (imageBlocked) return respond({ text: imageBlocked });
      if (!apiKey) {
        return respond({
          text: "کلید AvalAI برای ساخت تصویر تنظیم نشده است.",
        });
      }
      const logoSrc = shouldStampLogo(askText, messages)
        ? lastImagesNow[0] || findLastUserImages(messages)[0] || lastImage || ""
        : "";
      console.log("IMAGE_GATE", {
        lastImage: !!lastImage,
        generate: true,
        edit: false,
      });
      console.log("IMAGE_MULTI", {
        count,
        hasLastImage: !!lastImage,
        path: "generate",
      });
      console.log("IMAGE_PATH", "generate", askText.slice(0, 80));
      console.log("CHAT_PROVIDER", "avalai", "image-generate");
      return respond(
        await generateImageSet(apiKey, askText, count, logoSrc, messages)
      );
    }

    if (fileByIntent || (docIntent.type !== "chat" && docIntent.type !== "image")) {
      const fileBlocked = limitText("file");
      if (fileBlocked) return respond({ text: fileBlocked });
      const kind = fileKind || docIntent.kind || "word";
      if (kind === "pptx") {
        return respond(
          attachSavedLine(
            withOcrNote(
              await makePptxDeck({
                userAsk: userAskOnly(lastText),
                sourceText: collectPptSourceText(messages, lastText),
                memoryPrompt,
                topicHint: docIntent.topic,
                avalaiKey: apiKey,
              })
            )
          )
        );
      }
      return respond(
        attachSavedLine(
          withOcrNote(
            await makeDocument(
              apiKey,
              lastText,
              kind,
              sourceImage,
              memoryPrompt
            )
          )
        )
      );
    }

    const chatBlocked = limitText("chat");
    if (chatBlocked) return respond({ text: chatBlocked });
    return streamChat(messages);
    });
  } catch (err) {
    console.log("CHAT_POST_ERROR", err);
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    const detail = errMessage(err);

    return NextResponse.json({
      text: timedOut
        ? "زمان ساخت فایل یا تصویر تمام شد."
        : "پردازش پیام انجام نشد. " + String(detail).slice(0, 180),
    });
  }
}
