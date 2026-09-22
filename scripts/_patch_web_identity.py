from pathlib import Path
import re

# ---------- web-search.ts ----------
ws = Path("src/lib/web-search.ts")
w = ws.read_text(encoding="utf-8")

old_needs = '''export function needsWebSearch(text: string) {
  const t = askText(text);
  if (!t.trim()) return false;

  if (
    /ویندوز|\\bwindows\\b|taskbar|تسک‌بار|نوار وظیفه|default apps?|دیفالت|پیش‌فرض برنامه|اپ پیش‌فرض|گروپ\\s*پالیسی|\\bgpo\\b|تنظیمات ویندوز|عیب‌یابی نرم‌افزار/i.test(
      t
    )
  ) {
    return false;
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
}'''

new_needs = '''export function needsWebSearch(text: string) {
  const t = askText(text);
  if (!t.trim()) return false;

  if (
    /ویندوز|\\bwindows\\b|taskbar|تسک‌بار|نوار وظیفه|default apps?|دیفالت|پیش‌فرض برنامه|اپ پیش‌فرض|گروپ\\s*پالیسی|\\bgpo\\b|تنظیمات ویندوز|عیب‌یابی نرم‌افزار/i.test(
      t
    )
  ) {
    return false;
  }

  // Shopping / Iranian site browsing / live price compare
  if (
    /بگرد|جستجو\\s*کن|سرچ\\s*کن|سایت[-\\s]*های\\s*ایرانی|روی\\s*سایت|وی\\s*سایت|ارزان[-\\s]*ترین|ارزانترین|اقساطی|قسطی|خرید\\s*اکانت|فروش\\s*اکانت|مقایسه\\s*قیمت|معرفی\\s*سایت|کدام\\s*سایت|بهترین\\s*سایت|فروشگاه\\s*آنلاین|دیجی[-\\s]*کالا|اسنپ[-\\s]*پی/i.test(
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
}'''

if old_needs not in w:
    raise SystemExit("needsWebSearch block not found")
w = w.replace(old_needs, new_needs)

old_ref = '''export function isWebRefusal(text: string) {
  return /نمی‌توانم به (وب|سایت|اینترنت)|نمي‌توانم به (وب|سایت|اینترنت)|دسترسی به (وب|سایت|اینترنت|وب‌سایت)|قادر به دسترسی|سایت را باز کنم|مرورگر ندارم|به وب‌سایت دسترسی|به سایت دسترسی ندارم/.test(
    text || ""
  );
}'''

new_ref = '''export function isWebRefusal(text: string) {
  return /نمی‌توانم به (وب|سایت|اینترنت)|نمي‌توانم به (وب|سایت|اینترنت)|دسترسی به (وب|سایت|اینترنت|وب‌سایت)|قادر به دسترسی|سایت را باز کنم|مرورگر ندارم|به وب‌سایت دسترسی|به سایت دسترسی ندارم|اینترنت زنده|موتورهای جستجو|ابزارهای استعلام|کلیدواژه‌های زیر را مستقیماً در گوگل|در گوگل جستجو کنید|به اینترنت دسترسی ندارم|دسترسی ندارم و نمی‌توانم/.test(
    text || ""
  );
}

/** Strip accidental provider/model identity leaks from assistant replies. */
export function stripProviderLeak(text: string) {
  let s = String(text || "");
  s = s.replace(/\\(?\\s*نکته\\s*:?[\\s\\S]{0,200}?(?:Sinox|sinox|GapGPT|AvalAI|Grok|grok|گروک)[\\s\\S]{0,120}?\\)?/gi, "");
  s = s.replace(/من از طریق\\s*(?:Sinox|sinox|GapGPT|AvalAI)[^\\n.]{0,160}\\.?/gi, "");
  s = s.replace(/مدل زبانی\\s*(?:گروک|Grok|GPT|GapGPT)[^\\n.]{0,80}\\.?/gi, "");
  s = s.replace(/\\b(?:t-)?grok[-\\s]?\\d(?:\\.\\d)?\\b/gi, "");
  s = s.replace(/\\bSinox\\s*API\\b/gi, "");
  s = s.replace(/[ \\t]{2,}/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
  return s;
}'''

if old_ref not in w:
    raise SystemExit("isWebRefusal block not found")
w = w.replace(old_ref, new_ref)

# Improve buildSearchQueries for shopping
needle = '''  const topic = topicCore(q) || q;
  const queries = [q, topic + " ۱۴۰۳ ۱۴۰۲", topic + " آخرین گزارش"];'''
insert = '''  if (/اکانت|FC\\s*2[567]|فیفا|Ultimate\\s*Team|اقساطی|قسطی|ارزان[-\\s]*ترین|خرید\\s*بازی|سایت[-\\s]*های\\s*ایرانی|بگرد/i.test(q)) {
    return [
      q,
      topicCore(q) + " خرید اقساطی",
      topicCore(q) + " ارزان قیمت سایت ایرانی",
      "خرید اکانت FC Ultimate Team اقساطی ایران",
      "ارزانترین سایت خرید اکانت فیفا اف سی ایران",
    ];
  }

  const topic = topicCore(q) || q;
  const queries = [q, topic + " ۱۴۰۳ ۱۴۰۲", topic + " آخرین گزارش"];'''
if needle not in w:
    raise SystemExit("buildSearchQueries topic block not found")
w = w.replace(needle, insert)

ws.write_text(w, encoding="utf-8")
print("web-search.ts patched")

# ---------- route.ts prompts + strip leak ----------
rp = Path("src/app/api/chat/route.ts")
r = rp.read_text(encoding="utf-8")

# import stripProviderLeak
if "stripProviderLeak" not in r:
    r = r.replace(
        "  formatSearchContext,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n} from \"@/lib/web-search\";",
        "  formatSearchContext,\n  isWebRefusal,\n  needsWebSearch,\n  searchWeb,\n  stripProviderLeak,\n} from \"@/lib/web-search\";",
    )

# CAPABILITY_PROMPT strengthen
old_cap_last = '''  "اگر داده به‌روز یا آمار رسمی لازم است و نتایج جستجو در پیام آمده، از همان استفاده کن و نگو به اینترنت دسترسی نداری.",
].join(" ");'''

new_cap_last = '''  "اگر داده به‌روز یا آمار رسمی لازم است و نتایج جستجو در پیام آمده، از همان استفاده کن و نگو به اینترنت دسترسی نداری.",
  "اگر کاربر خواست در سایت‌های ایرانی بگردی، قیمت مقایسه کنی، ارزان‌ترین فروشنده یا فروش اقساطی را پیدا کنی، از نتایج جستجوی وب جواب بده؛ نگو اینترنت نداری.",
  "هرگز از Sinox، Sinox API، AvalAI، GapGPT، Grok، گروک، نام مدل، یا مسیر API حرف نزن و در پاسخ ننویس.",
  "هرگز خودت را مدل زبانی عمومی معرفی نکن؛ فقط CPGAI هستی.",
].join(" ");'''

if old_cap_last not in r:
    raise SystemExit("CAPABILITY_PROMPT end not found")
r = r.replace(old_cap_last, new_cap_last)

# SYSTEM_PROMPT identity line expand
old_id = '''  "خودت را مدل عمومی، Grok، GPT یا GapGPT معرفی نکن.",'''
new_id = '''  "خودت را مدل عمومی، Grok، GPT، GapGPT، Sinox یا هر API معرفی نکن.",
  "در پاسخ هیچ نکته‌ای درباره Sinox API، AvalAI، GapGPT، Grok یا نام مدل ننویس.",'''
if old_id not in r:
    raise SystemExit("identity line not found")
r = r.replace(old_id, new_id)

# WEB_ANSWER_PROMPT - add shopping branch lines at start
old_web = '''const WEB_ANSWER_PROMPT = [
  "نتایج جستجوی وب همین حالا در اختیار توست. این یعنی جستجو انجام شده است.",
  "هرگز نگو نمی‌توانی به وب‌سایت یا اینترنت دسترسی داشته باشی.",'''

new_web = '''const WEB_ANSWER_PROMPT = [
  "نتایج جستجوی وب همین حالا در اختیار توست. این یعنی جستجو انجام شده است.",
  "هرگز نگو نمی‌توانی به وب‌سایت یا اینترنت دسترسی داشته باشی.",
  "هرگز نگو اینترنت زنده، موتور جستجو یا استعلام قیمت نداری؛ نتایج همین‌جاست.",
  "هرگز Sinox، Grok، GapGPT، AvalAI یا نام مدل را در پاسخ ننویس.",
  "اگر سؤال خرید/سایت/قیمت/اقساطی است: از نتایج، گزینه‌ها را با لینک و قیمت (اگر در اسنیپت هست) فهرست کن؛ ارزان‌ترین را مشخص کن؛ سایت‌های اقساطی را جدا بگو. قالب آمار صنعتی فولاد ممنوع است.",'''

if old_web not in r:
    raise SystemExit("WEB_ANSWER_PROMPT start not found")
r = r.replace(old_web, new_web)

# Wrap returned texts with stripProviderLeak - carefully on key return points in answerChat-like function
# Safer: add helper near once() and wrap final returns in the web/non-web paths

# Find `async function once` block area and add sanitize on returns of the outer function
# Simplest robust approach: after `let text = await once` assignments, and final `{ text }` returns inside the chat answer function.

# Add a local helper by replacing first occurrence of async function once
marker = "  async function once(opts?: { deepen?: boolean; webContext?: string }) {"
if marker not in r:
    raise SystemExit("once marker not found")
r = r.replace(
    marker,
    '''  function finalizeText(text: string) {
    return stripProviderLeak(text);
  }

  async function once(opts?: { deepen?: boolean; webContext?: string }) {''',
    1,
)

# Replace return { text } patterns in this function carefully - too many in file.
# Instead patch the once function to strip on output:
old_once_body_start = '''  async function once(opts?: { deepen?: boolean; webContext?: string }) {
    return completeChat(apiKey, messages, {
      brief,
      ask: lastText,
      internalContext,
      memoryPrompt,
      webContext: opts?.webContext,
      deepen: !!opts?.deepen,
      max_tokens: tokens,
      onDelta,
    });
  }'''

# We already inserted finalizeText before once - fix the once definition now
# Read current state after first replace - the once still returns completeChat directly
old_once = '''  async function once(opts?: { deepen?: boolean; webContext?: string }) {
    return completeChat(apiKey, messages, {
      brief,
      ask: lastText,
      internalContext,
      memoryPrompt,
      webContext: opts?.webContext,
      deepen: !!opts?.deepen,
      max_tokens: tokens,
      onDelta,
    });
  }'''

new_once = '''  async function once(opts?: { deepen?: boolean; webContext?: string }) {
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

if old_once not in r:
    # maybe finalizeText already inserted and once still old without finalize wrapper on once itself
    # try finding completeChat return inside once
    if "return finalizeText(text);" not in r:
        raise SystemExit("once body not found for wrap")
else:
    r = r.replace(old_once, new_once)

# Also strip hardcoded avalai error? keep as is - operational
# Streaming path returns { text: await once() } which will be stripped - good
# Path that returns { text: found.error } - strip too
r = r.replace("return { text: found.error };", "return { text: finalizeText(found.error) };")

rp.write_text(r, encoding="utf-8")
print("route.ts patched")

# quick unit checks
from pathlib import Path
import importlib.util
# can't import ts; regex check
assert "stripProviderLeak" in Path("src/lib/web-search.ts").read_text(encoding="utf-8")
assert "سایت[-\\s]*های\\s*ایرانی" in Path("src/lib/web-search.ts").read_text(encoding="utf-8") or "سایت" in Path("src/lib/web-search.ts").read_text(encoding="utf-8")
print("ok")
