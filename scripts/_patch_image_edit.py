from pathlib import Path

# ---- image-work.ts ----
p = Path("src/lib/image-work.ts")
t = p.read_text(encoding="utf-8")

old = '''function refersToExistingImage(text: string) {
  return /ویرایش|همین عکس را تغییر|همین عکس را عوض|این عکس را تغییر بده|این عکس را عوض کن|لوگوی این عکس را عوض|پس‌زمینه|پس زمینه|بک.?گراند|بکگراند|background/.test(
    text
  );
}'''

new = '''function refersToExistingImage(text: string) {
  return /ویرایش|همین عکس را تغییر|همین عکس را عوض|این عکس را تغییر بده|این عکس را عوض کن|لوگوی این عکس را عوض|پس‌زمینه|پس زمینه|بک.?گراند|بکگراند|background|همین عکس|این عکس|عکس رو ببین|عکس را ببین|تصویر رو ببین|تصویر را ببین|داخل عکس|داخل تصویر|روی عکس|روی تصویر|قسمت بالا|سمت چپ|سمت راست|خط دوم|نوشته رو حذف|متن رو حذف|این نوشته|این متن/.test(
    text
  );
}

/** Surgical change verbs that imply edit when an image is attached. */
export function isSurgicalImageChange(text: string) {
  const t = askOnly(text);
  if (!t) return false;
  return /حذف کن|پاک کن|عوض کن|تغییر بده|تغییر بده|اصلاح کن|درستش کن|درست کن|فونت|B\\s*Nazanin|بی\\s*نازنین|نازنین|RTL|راست[-\\s]*چین|ابری|رنگ|فقط همین|هیچ تغییر دیگه|هیچ تغییر دیگری|میپتا|میتا|خط\\s*(?:اول|دوم|سوم)|نوشته|متن/.test(
    t
  );
}'''

if old not in t:
    raise SystemExit("refersToExistingImage not found")
t = t.replace(old, new)

old_edit = '''export function isImageEditAsk(text: string) {
  const t = askOnly(text);
  if (!t || isDocOutputAsk(t)) return false;
  if (/از روی این سند|متن را بخوان|متن تصویر/.test(t)) return false;
  if (/پرامپت|همین (?:را|رو) بساز|همین طرح/.test(t)) return false;
  if (isImageGenerateAsk(t)) return false;
  return refersToExistingImage(t);
}'''

new_edit = '''export function isImageEditAsk(text: string, hasAttachedImage = false) {
  const t = askOnly(text);
  if (!t || isDocOutputAsk(t)) return false;
  // Reading OCR from image for a document is not an image edit.
  if (/از روی این سند|متن را بخوان|متن تصویر را استخراج|OCR/i.test(t) && !isSurgicalImageChange(t)) {
    return false;
  }
  if (/پرامپت|همین (?:را|رو) بساز|همین طرح/.test(t) && !/ویرایش|حذف|عوض|تغییر/.test(t)) {
    return false;
  }
  if (isImageGenerateAsk(t) && !hasAttachedImage) return false;
  if (isImageGenerateAsk(t) && hasAttachedImage && isSurgicalImageChange(t)) {
    // Prefer edit when user attached a photo and asked for a surgical change.
    return true;
  }
  if (isImageGenerateAsk(t)) return false;
  if (refersToExistingImage(t)) return true;
  if (hasAttachedImage && isSurgicalImageChange(t)) return true;
  return false;
}'''

if old_edit not in t:
    raise SystemExit("isImageEditAsk not found")
t = t.replace(old_edit, new_edit)

# Update isImageWorkAsk to pass has image
old_work = '''export function isImageWorkAsk(
  text: string,
  messages?: { role?: string; content?: string; image?: string; images?: string[] }[]
) {
  if (isImageGenerateAsk(text) || isImageEditAsk(text)) return true;
  if (findResumeImageAsk(messages)) return true;
  const t = askOnly(text);
  if (!t) return false;
  if (lastAssistantWroteImagePrompt(messages) && /بساز|درست کن|اجرا|رندر|عکس|تصویر|طرح/.test(t)) {
    return true;
  }
  return false;
}'''

new_work = '''export function isImageWorkAsk(
  text: string,
  messages?: { role?: string; content?: string; image?: string; images?: string[] }[]
) {
  const hasImg = !!(
    findLastAnyImage(messages || []) ||
    (messages || []).some((m) => collectMessageImages(m).length)
  );
  if (isImageEditAsk(text, hasImg) || isImageGenerateAsk(text)) return true;
  if (findResumeImageAsk(messages)) return true;
  const t = askOnly(text);
  if (!t) return false;
  if (hasImg && isSurgicalImageChange(t)) return true;
  if (lastAssistantWroteImagePrompt(messages) && /بساز|درست کن|اجرا|رندر|عکس|تصویر|طرح/.test(t)) {
    return true;
  }
  return false;
}'''

if old_work not in t:
    raise SystemExit("isImageWorkAsk not found")
t = t.replace(old_work, new_work)

# Add collectEditPrompt function near collectGenerateImagePrompt
if "export function collectEditPrompt" not in t:
    gen = t.find("export function collectGenerateImagePrompt")
    if gen < 0:
        raise SystemExit("collectGenerateImagePrompt missing")
    insert = '''export function collectEditPrompt(lastText: string) {
  return [
    "You are editing an EXISTING image. Do not create a brand-new unrelated picture.",
    "Keep the same composition, aspect ratio, layout, colors, photos, icons, and all text that the user did not mention.",
    "Apply ONLY the change the user asked for (e.g. delete one text line, fix a spelling, change font).",
    "Do not add steel, mining, factories, or CPG branding unless the user asked.",
    "Do not shrink the design into a small card on a blank canvas. Fill the full frame like the original.",
    "If Persian text remains or is added, render it clearly RTL.",
    "Output the edited image only.",
    "User request: " + askOnly(lastText),
  ].join("\\n\\n");
}

'''
    t = t[:gen] + insert + t[gen:]

p.write_text(t, encoding="utf-8")
print("image-work patched")

# ---- route.ts ----
rpath = Path("src/app/api/chat/route.ts")
r = rpath.read_text(encoding="utf-8")

# Import collectEditPrompt if needed
if "collectEditPrompt" not in r:
    r = r.replace(
        "collectImagePrompt,",
        "collectEditPrompt,\n  collectImagePrompt,",
    )

# Strengthen buildEditPrompt
old_bep = '''function buildEditPrompt(userText: string) {
  if (isImageWorkAsk(userText) && !/چهره|صورت|آدم|شخص|پرتره/.test(userText || "")) {
    return [
      "Edit this graphic or design image according to the user.",
      "Output an actual image, not a text description.",
      "Keep the overall composition unless they asked to change it.",
      "Apply color, background, logo, and title changes they requested.",
      "If Persian titles were requested, render them clearly.",
      "User request: " + (userText || ""),
    ].join(" ");
  }
  return [
    "فقط تغییر خواسته‌شده را اعمال کن.",
    "چهره، بدن، لباس، مو و هویت فرد را دقیقاً حفظ کن.",
    "هیچ تغییری روی صورت نده.",
    "درخواست کاربر: " + (userText || ""),
  ].join(" ");
}'''

new_bep = '''function buildEditPrompt(userText: string) {
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
}'''

if old_bep not in r:
    raise SystemExit("buildEditPrompt not found")
r = r.replace(old_bep, new_bep)

# Fix editAsk to pass has image - need lastImagesNow before editAsk
# Looking at code order: editAsk is computed BEFORE lastImage in some places
# Current order:
# editAsk = ... isImageEditAsk(lastText);
# lastImage = ...
# Fix: compute hasAttached earlier

old_gate = '''    const generateAsk =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      (imageByIntent || isImageGenerateAsk(lastText) || !!resumeAsk);
    const editAsk =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      !generateAsk &&
      isImageEditAsk(lastText);
    const imageWork =
      !forceWord &&
      !reviseAsk &&
      !pptAsk &&
      !fileByIntent &&
      (imageByIntent || generateAsk || editAsk || isImageWorkAsk(lastText, messages));
    const refersToImage =
      /از روی این|این تصویر|این عکس|متن تصویر|تصویر را|عکس را|این لوگو|لوگو را|ببین/.test(
        lastText
      ) || lastImagesNow.length > 0;
    const lastImage =
      lastImagesNow[0] ||
      (imageWork || refersToImage ? findLastAnyImage(messages) : "") ||
      (refersToImage ? findLastUserImage(messages) : "");'''

new_gate = '''    const hasAttachedImage =
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
      (refersToImage ? findLastUserImage(messages) : "");'''

if old_gate not in r:
    raise SystemExit("IMAGE_GATE block not found")
r = r.replace(old_gate, new_gate)

# Fix shouldEdit path: use collectEditPrompt; no generate fallback on edit failure
old_exec = '''        if (shouldEdit) {
          const prompt = collectImagePrompt(messages, lastText);
          const extra = logoSrc && logoSrc !== source ? [logoSrc] : [];
          const edited = await editImage(apiKey, source, prompt, true, extra);
          if (edited.image) {
            return respond(edited);
          }
        }
        return respond(
          await generateImageSet(apiKey, lastText, count, logoSrc, messages)
        );'''

new_exec = '''        if (shouldEdit) {
          const prompt = collectEditPrompt(lastText);
          const extra = logoSrc && logoSrc !== source ? [logoSrc] : [];
          const edited = await editImage(apiKey, source, prompt, true, extra);
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
        );'''

if old_exec not in r:
    raise SystemExit("shouldEdit exec block not found")
r = r.replace(old_exec, new_exec)

# CAPABILITY: stronger anti-refusal for edit
old_cap = '''  "راهنمای فتوشاپ، وعده صبر، یا «نمی‌توانم تصویر بسازم» به‌جای ساخت واقعی ممنوع است.",'''
new_cap = '''  "راهنمای فتوشاپ، وعده صبر، یا «نمی‌توانم تصویر بسازم» به‌جای ساخت واقعی ممنوع است.",
  "اگر کاربر خواست متنی را از روی عکس حذف/عوض کنی یا فونت عکس را عوض کنی، ویرایش واقعی انجام می‌شود؛ نگو ابزار ادیت نداری.",
  "هرگز برای ویرایش عکس نگو از فتوشاپ، پینت، InShot یا PicsArt استفاده کند.",'''
if old_cap not in r:
    raise SystemExit("capability line missing")
r = r.replace(old_cap, new_cap)

rpath.write_text(r, encoding="utf-8")
print("route patched")
