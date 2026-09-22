from pathlib import Path

ws = Path("src/lib/web-search.ts")
w = ws.read_text(encoding="utf-8")

# Expand isWebRefusal
old_ref = '''export function isWebRefusal(text: string) {
  return /نمی‌توانم به (وب|سایت|اینترنت)|نمي‌توانم به (وب|سایت|اینترنت)|دسترسی به (وب|سایت|اینترنت|وب‌سایت)|قادر به دسترسی|سایت را باز کنم|مرورگر ندارم|به وب‌سایت دسترسی|به سایت دسترسی ندارم|اینترنت زنده|موتورهای جستجو|ابزارهای استعلام|کلیدواژه‌های زیر را مستقیماً در گوگل|در گوگل جستجو کنید|به اینترنت دسترسی ندارم|دسترسی ندارم و نمی‌توانم/.test(
    text || ""
  );
}'''

new_ref = '''export function isWebRefusal(text: string) {
  return /نمی‌توانم به (وب|سایت|اینترنت)|نمي‌توانم به (وب|سایت|اینترنت)|دسترسی به (وب|سایت|اینترنت|وب‌سایت)|قادر به دسترسی|سایت را باز کنم|مرورگر ندارم|به وب‌سایت دسترسی|به سایت دسترسی ندارم|اینترنت زنده|موتورهای جستجو|ابزارهای استعلام|کلیدواژه‌های زیر را مستقیماً در گوگل|در گوگل (جستجو|سرچ) کنید|در گوگل سرچ|گوگل سرچ کنید|عبارت زیر را در گوگل|لطفاً عبارت زیر را|پیشنهاد می‌کنم برای پیدا کردن|به اینترنت دسترسی ندارم|دسترسی ندارم و نمی‌توانم/.test(
    text || ""
  );
}

/** Iranian site browsing / price compare / installment shopping ask. */
export function isShoppingBrowseAsk(text: string) {
  const t = askText(text);
  return /بگرد|سایت[-\\s]*های\\s*ایرانی|وی\\s*سایت|روی\\s*سایت|ارزان[-\\s]*ترین|ارزانترین|اقساطی|قسطی|خرید\\s*اکانت|فروش\\s*اکانت|معرفی\\s*سایت|کدام\\s*سایت|بهترین\\s*سایت|مقایسه\\s*قیمت/i.test(
    t
  );
}

/** True if the assistant reply actually cites at least one searched result. */
export function answerUsesSearchHits(answer: string, hits: WebHit[]) {
  const a = String(answer || "").toLowerCase();
  if (!a.trim() || !hits?.length) return false;
  return hits.some((h) => {
    try {
      const host = new URL(h.url).hostname.replace(/^www\\./, "").toLowerCase();
      if (host && a.includes(host)) return true;
    } catch {
      /* ignore */
    }
    const title = String(h.title || "").slice(0, 24);
    return title.length >= 8 && a.includes(title.toLowerCase());
  });
}'''

if old_ref not in w:
    raise SystemExit("isWebRefusal block missing")
w = w.replace(old_ref, new_ref)
ws.write_text(w, encoding="utf-8")
print("web-search helpers updated")

# Improve formatShoppingFallback to pick cheapest mention if any prices in snippets
# Optional - current fallback is already good. Enhance intro for FC27.
old_fb_start = '''  const lines = [
    "بر اساس جستجوی همین الان در وب، این گزینه‌ها از سایت‌های ایرانی پیدا شد:",
    "",
  ];'''
new_fb_start = '''  const priceHits = list.filter((h) =>
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
  }'''
if old_fb_start in w:
    w = Path("src/lib/web-search.ts").read_text(encoding="utf-8")
    if old_fb_start in w:
        w = w.replace(old_fb_start, new_fb_start)
        Path("src/lib/web-search.ts").write_text(w, encoding="utf-8")
        print("fallback intro improved")
else:
    print("fallback start not found - skip intro")

# ---- route.ts: for shopping browse, prefer fallback when hits unused ----
rp = Path("src/app/api/chat/route.ts")
r = rp.read_text(encoding="utf-8")

if "isShoppingBrowseAsk" not in r:
    r = r.replace(
        "  formatShoppingFallback,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n  stripProviderLeak,\n} from \"@/lib/web-search\";",
        "  answerUsesSearchHits,\n  formatShoppingFallback,\n  isShoppingBrowseAsk,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n  stripProviderLeak,\n} from \"@/lib/web-search\";",
    )

# Replace stream shopping success block to force fallback for shopping asks
old = '''          const webContext = formatSearchContext(found.hits);
          console.log("CHAT_ONCE", { deepen: false, web: true, tokens, stream: true });
          let text = await once({ webContext, silent: true });
          if ((isWebRefusal(text) || /Sinox|grok-4|گروک/i.test(text)) && !helpAsk) {
            console.log("CHAT_ONCE", { deepen: true, web: true, tokens, stream: true });
            const direct = await once({ deepen: true, webContext, silent: true });
            if (!isWebRefusal(direct) && direct.trim()) text = direct;
          }
          if (isWebRefusal(text) || /Sinox|grok-4|گروک|به اینترنت زنده/i.test(text)) {
            text = formatShoppingFallback(found.hits, lastText);
          }
          text = await emitFinal(text);
          return { text };'''

new = '''          const webContext = formatSearchContext(found.hits);
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
          return { text };'''

if old not in r:
    raise SystemExit("stream shopping block not found")
r = r.replace(old, new)

# Non-stream path: same shopping short-circuit after found.ok
old2 = '''      const webContext = formatSearchContext(found.hits);
      console.log("CHAT_ONCE", { deepen: false, web: true, tokens });
      let text = await once({ webContext });'''

# There may be only one such in non-stream - check
count = r.count(old2)
print("nonstream once count", count)

# Find non-stream section more carefully - after "if (wantWeb)" without onDelta
# Insert shopping short-circuit after webContext in non-stream
marker = '''    const found = await searchWeb(avalai.apiKey, lastText);
    if (found.ok) {
      const webContext = formatSearchContext(found.hits);
      console.log("CHAT_ONCE", { deepen: false, web: true, tokens });
      let text = await once({ webContext });'''

repl = '''    const found = await searchWeb(avalai.apiKey, lastText);
    if (found.ok) {
      const webContext = formatSearchContext(found.hits);
      if (isShoppingBrowseAsk(lastText)) {
        console.log("CHAT_ONCE", { deepen: false, web: true, shopping: true, tokens });
        return { text: finalizeText(formatShoppingFallback(found.hits, lastText)) };
      }
      console.log("CHAT_ONCE", { deepen: false, web: true, tokens });
      let text = await once({ webContext });'''

if marker not in r:
    raise SystemExit("nonstream marker not found")
r = r.replace(marker, repl, 1)

rp.write_text(r, encoding="utf-8")
print("route shopping force-fallback done")
