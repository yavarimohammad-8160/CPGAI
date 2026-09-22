import { NextRequest, NextResponse } from "next/server";
import db, { nowIso, uid } from "@/lib/db";
import { addMemory } from "@/lib/memory";
import { chatCompletions, getTextClient, parseCompletion } from "@/lib/llm";
import { canonUsername } from "@/lib/users";

export const runtime = "nodejs";

type Body = {
  username?: string;
  conversationId?: string;
  messageId?: string;
  rating?: "up" | "down";
  reason?: string;
  userAsk?: string;
  assistantText?: string;
  action?: "rate" | "analyze";
};

function userOf(req: NextRequest, body?: Body) {
  return canonUsername(
    body?.username || req.headers.get("x-cpgai-user") || ""
  );
}

function looksSubstantive(reason: string) {
  const t = String(reason || "").trim();
  if (t.length < 3) return false;
  if (/^(lol|هه‌هه|خخخ|تست|test|ok|باشه|هیچی|الکی|شوخی|سر به سر|ندارم)$/i.test(t)) {
    return false;
  }
  if (/^[.!?؟\s]+$/.test(t)) return false;
  return true;
}

function heuristicReply(rating: "up" | "down", reason: string, substantive: boolean) {
  if (rating === "up") return "";
  if (!reason.trim()) {
    return "ببخشید که پاسخ براتون مفید نبود. اگر بگید دقیقاً چه ایرادی داشت، همان را اصلاح می‌کنم.";
  }
  if (!substantive) {
    return "متوجه شدم، ولی برای اینکه درست یاد بگیرم لطفاً دلیل واقعی‌تان را بگویید (مثلاً غلط بود، ناقص بود، یا لحن مناسب نبود).";
  }
  return (
    "ممنون از بازخوردتان. بابت این مورد عذرخواهی می‌کنم. " +
    "اگر بخواهید، همین پاسخ را با در نظر گرفتن نکته‌تان دوباره می‌سازم."
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const username = userOf(req, body);
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!rating) {
    return NextResponse.json({ error: "rating نامعتبر است." }, { status: 400 });
  }

  const reason = String(body.reason || "").trim().slice(0, 800);
  const substantive = rating === "down" ? looksSubstantive(reason) : false;
  const id = uid();
  const ts = nowIso();

  db.prepare(
    `INSERT INTO message_feedback
      (id, username, conversation_id, message_id, rating, reason, user_ask, assistant_snippet, substantive, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    username,
    String(body.conversationId || ""),
    String(body.messageId || ""),
    rating,
    reason,
    String(body.userAsk || "").slice(0, 1200),
    String(body.assistantText || "").slice(0, 2000),
    substantive ? 1 : 0,
    ts
  );

  let reply = heuristicReply(rating, reason, substantive);
  let learned = false;

  if (rating === "down" && substantive) {
    const pattern =
      "الگوی بازخورد منفی کاربر: " +
      reason +
      (body.userAsk ? " | زمینه سؤال: " + String(body.userAsk).slice(0, 180) : "");
    const saved = addMemory({
      username,
      scope: "user",
      topic: "style",
      content: pattern.slice(0, 500),
    });
    learned = !("error" in saved);

    try {
      const client = getTextClient();
      if (client && body.action === "analyze") {
        const data = await chatCompletions(
          client,
          {
            messages: [
              {
                role: "system",
                content:
                  "تو CPGAI هستی. فقط یک پیام کوتاه فارسی بنویس: عذرخواهی حرفه‌ای بابت بازخورد منفی، اشاره کوتاه به دلیل کاربر، و پیشنهاد بازتولید پاسخ. بدون نام مدل و بدون markdown.",
              },
              {
                role: "user",
                content:
                  "دلیل کاربر: " +
                  reason +
                  "\nخلاصه پاسخ قبلی: " +
                  String(body.assistantText || "").slice(0, 400),
              },
            ],
            temperature: 0.2,
            max_tokens: 220,
          },
          { timeoutMs: 25000 }
        );
        const text = parseCompletion(data).text.trim();
        if (text && text.length < 600) reply = text;
      }
    } catch (err) {
      console.log("FEEDBACK_LLM_FAIL", err);
    }
  }

  return NextResponse.json({
    ok: true,
    id,
    rating,
    substantive,
    reply,
    learned,
  });
}
