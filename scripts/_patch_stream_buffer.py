from pathlib import Path

# ---- Add formatShoppingFallback to web-search.ts ----
ws = Path("src/lib/web-search.ts")
w = ws.read_text(encoding="utf-8")
if "formatShoppingFallback" not in w:
    marker = "export function stripProviderLeak"
    idx = w.find(marker)
    if idx < 0:
        raise SystemExit("stripProviderLeak missing")
    helper = '''
export function formatShoppingFallback(hits: WebHit[], ask: string) {
  const list = (hits || []).filter((h) => h?.url && h?.title).slice(0, 8);
  if (!list.length) {
    return "نتیجه معتبری از سایت‌های ایرانی برای این جستجو پیدا نشد. کمی بعد دوباره امتحان کنید.";
  }
  const installment = list.filter((h) =>
    /اقساط|قسط|اسنپ\\s*پی|ازکی|نخل\\s*کارت|توبانک|دیجی\\s*پی|خرید\\s*قسطی/i.test(
      `${h.title} ${h.snippet}`
    )
  );
  const lines = [
    "بر اساس جستجوی همین الان در وب، این گزینه‌ها از سایت‌های ایرانی پیدا شد:",
    "",
  ];
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
  if (/FC\\s*27|اف\\s*سی\\s*۲۷|اف\\s*سی\\s*27/i.test(ask)) {
    lines.push(
      "نکته: FC 27 در نتایج به‌صورت پیش‌خرید/نسخه‌های قانونی دیده می‌شود؛ قبل از پرداخت، پلتفرم (PS4/PS5) و نوع اکانت را از خود فروشگاه تأیید کنید."
    );
  }
  return lines.join("\\n");
}

'''
    w = w[:idx] + helper + w[idx:]
    ws.write_text(w, encoding="utf-8")
    print("added formatShoppingFallback")
else:
    print("formatShoppingFallback exists")

# ---- Patch route.ts ----
rp = Path("src/app/api/chat/route.ts")
r = rp.read_text(encoding="utf-8")

# import formatShoppingFallback
if "formatShoppingFallback" not in r:
    r = r.replace(
        "  formatSearchContext,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n  stripProviderLeak,\n} from \"@/lib/web-search\";",
        "  formatSearchContext,\n  formatShoppingFallback,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n  stripProviderLeak,\n} from \"@/lib/web-search\";",
    )

# Hard identity lock prepended in completeChat system
old_sys_mem = "  const systemWithMemory = system + memoryBlock;"
new_sys_mem = '''  const identityLock = [
    "قفل هویت: نام تو فقط CPGAI است.",
    "هرگز از Sinox، Sinox API، AvalAI، GapGPT، Grok، گروک، t-grok، grok-4.5 یا نام مدل حرف نزن.",
    "هرگز نگو به اینترنت/مرورگر/جستجو دسترسی نداری اگر نتایج جستجو در پیام هست.",
    "اگر نتایج جستجو هست، همان را خلاصه و مفید جواب بده.",
  ].join(" ");
  const systemWithMemory = identityLock + "\\n\\n" + system + memoryBlock;'''
if old_sys_mem not in r:
    raise SystemExit("systemWithMemory not found")
r = r.replace(old_sys_mem, new_sys_mem)

# Fix once() to buffer then emit cleaned
old_once = '''  async function once(opts?: { deepen?: boolean; webContext?: string }) {
    const text = await completeChat(apiKey, messages, {
      brief,
      ask: lastText,
      internalContext,
      memoryPrompt,
      webContext: opts?.webContext,
      deepen: !!opts?.deepen,
      max_tokens: tokens,
      onDelta,
    });
    return finalizeText(text);
  }'''

new_once = '''  async function once(opts?: { deepen?: boolean; webContext?: string }) {
    // Never stream raw model tokens — Sinox/Grok may leak provider identity mid-stream.
    const text = await completeChat(apiKey, messages, {
      brief,
      ask: lastText,
      internalContext,
      memoryPrompt,
      webContext: opts?.webContext,
      deepen: !!opts?.deepen,
      max_tokens: tokens,
      onDelta: undefined,
    });
    const clean = finalizeText(text);
    if (onDelta && clean) {
      await emitTextLive(clean, onDelta);
    }
    return clean;
  }'''

if old_once not in r:
    raise SystemExit("once block not found exactly")
r = r.replace(old_once, new_once)

# Replace streaming wantWeb branch to retry + shopping fallback
old_stream_web = '''  if (onDelta) {
    onStatus?.(wantWeb ? "search" : "think");
    if (wantWeb) {
      const avalai = getAvalaiClient();
      if (avalai) {
        const found = await searchWeb(avalai.apiKey, lastText);
        if (found.ok) {
          const webContext = formatSearchContext(found.hits);
          console.log("CHAT_ONCE", { deepen: false, web: true, tokens, stream: true });
          const text = await once({ webContext });
          return { text };
        }
      }
    }
    console.log("CHAT_ONCE", { deepen: false, web: false, tokens, stream: true });
    return { text: await once() };
  }'''

new_stream_web = '''  if (onDelta) {
    onStatus?.(wantWeb ? "search" : "think");
    if (wantWeb) {
      const avalai = getAvalaiClient();
      if (avalai) {
        const found = await searchWeb(avalai.apiKey, lastText);
        if (found.ok) {
          const webContext = formatSearchContext(found.hits);
          console.log("CHAT_ONCE", { deepen: false, web: true, tokens, stream: true });
          let text = await once({ webContext });
          if ((isWebRefusal(text) || /Sinox|grok-4|گروک/i.test(text)) && !helpAsk) {
            console.log("CHAT_ONCE", { deepen: true, web: true, tokens, stream: true });
            const direct = await once({ deepen: true, webContext });
            if (!isWebRefusal(direct) && direct.trim()) text = direct;
          }
          if (isWebRefusal(text) || /Sinox|grok-4|گروک|به اینترنت زنده/i.test(text)) {
            text = finalizeText(formatShoppingFallback(found.hits, lastText));
            if (onDelta && text) await emitTextLive(text, onDelta);
          }
          return { text };
        }
      }
    }
    console.log("CHAT_ONCE", { deepen: false, web: false, tokens, stream: true });
    let text = await once();
    if (isWebRefusal(text) || /Sinox|grok-4|گروک/i.test(text)) {
      text = finalizeText(
        "الان نتیجه جستجوی وب برای این سؤال در دسترس نبود. بدون اشاره به زیرساخت: لطفاً یک‌بار دیگر بپرسید یا AvalAI سرچ را بررسی کنید."
      );
      // Avoid double-stream: once already streamed dirty-then-clean; if refusal slipped, emit replacement note only if needed
    }
    return { text: finalizeText(text) };
  }'''

if old_stream_web not in r:
    raise SystemExit("stream web branch not found")
r = r.replace(old_stream_web, new_stream_web)

# Non-stream path: if still refusal after deepen, shopping fallback
old_nonstream_return = '''      if (
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
            .join("\\n");
        }
      }
      return { text };
    }'''

# Add shopping fallback before return { text } in non-stream web success
needle = "      return { text };\n    }\n    if (internalContext) {"
if needle not in r:
    raise SystemExit("nonstream return needle not found")
r = r.replace(
    needle,
    '''      if (isWebRefusal(text) || /Sinox|grok-4|گروک|اینترنت زنده/i.test(text)) {
        text = finalizeText(formatShoppingFallback(found.hits, lastText));
      }
      return { text };
    }
    if (internalContext) {''',
    1,
)

rp.write_text(r, encoding="utf-8")
print("route patched")

# Fix potential double-emit on shopping fallback in stream path:
# once() already emitTextLive'd the refusal text. Then we emit fallback again = user sees both!
# Better: once should NOT emit when we'll maybe replace. Or once takes { silent?: boolean }

print("NOTE: need silent once for retry paths")
