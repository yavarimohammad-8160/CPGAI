from pathlib import Path

# ---- pdf-chrome.ts ----
p = Path("src/lib/pdf-chrome.ts")
t = p.read_text(encoding="utf-8")

if "doc-font" not in t:
    t = t.replace(
        'import puppeteer from "puppeteer-core";',
        'import puppeteer from "puppeteer-core";\nimport { FA_DOC_FONT_FILES, adaptTextForBNazanin } from "@/lib/doc-font";',
    )

old_font_fn = """function fontFileUrl(weight: \"Regular\" | \"Bold\") {
  const file = path.join(process.cwd(), \"public\", \"fonts\", `Vazirmatn-${weight}.ttf`);
"""
new_font_fn = """function fontFileUrl(weight: \"Regular\" | \"Bold\") {
  const name = weight === \"Bold\" ? FA_DOC_FONT_FILES.bold : FA_DOC_FONT_FILES.regular;
  const file = path.join(process.cwd(), \"public\", \"fonts\", name);
"""
if old_font_fn not in t:
    # try already patched
    if "FA_DOC_FONT_FILES" not in t:
        raise SystemExit("fontFileUrl block not found:\n" + t[t.find("function fontFileUrl"):t.find("function fontFileUrl")+200])
else:
    t = t.replace(old_font_fn, new_font_fn)

old_prep = """function prep(text: string, persianDigits: boolean) {
  let t = sanitizePdfText(text);
  if (persianDigits) t = toPersianDigits(t);
  return t;
}"""
new_prep = """function prep(text: string, persianDigits: boolean) {
  let t = adaptTextForBNazanin(sanitizePdfText(text));
  if (persianDigits) t = toPersianDigits(t);
  return t;
}"""
if old_prep in t:
    t = t.replace(old_prep, new_prep)
elif "adaptTextForBNazanin(sanitizePdfText" not in t:
    raise SystemExit("prep not found")

t = t.replace("font-family: Vazirmatn;", 'font-family: "B Nazanin";')
t = t.replace(
    'font-family: Vazirmatn, "Segoe UI", Tahoma, sans-serif;',
    'font-family: "B Nazanin", Tahoma, "Segoe UI", sans-serif;',
)

p.write_text(t, encoding="utf-8")
print("pdf-chrome ok; Vazir left", t.count("Vazirmatn"), "B Nazanin", t.count("B Nazanin"))

# ---- make-pptx.ts: Tahoma -> B Nazanin (Persian default); keep Calibri only if we add LTR branch later ----
mp = Path("src/lib/make-pptx.ts")
mt = mp.read_text(encoding="utf-8")
if "doc-font" not in mt:
    # add import after first import line
    lines = mt.splitlines(True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
    lines.insert(insert_at, 'import { FA_DOC_FONT } from "@/lib/doc-font";\n')
    mt = "".join(lines)

# Replace fontFace literals: use FA_DOC_FONT via template - simplest replace string Tahoma with B Nazanin for now
# Better: const faFace = FA_DOC_FONT and replace fontFace: "Tahoma" with fontFace: FA_DOC_FONT
count = mt.count('fontFace: "Tahoma"')
mt = mt.replace('fontFace: "Tahoma"', "fontFace: FA_DOC_FONT")
mp.write_text(mt, encoding="utf-8")
print("pptx replaced", count, "Tahoma -> FA_DOC_FONT")

# ---- office.ts FA_FONT already B Nazanin; Excel font + import adapt ----
op = Path("src/lib/office.ts")
ot = op.read_text(encoding="utf-8")
if "doc-font" not in ot:
    ot = ot.replace(
        'import { blocksToPdfHtml, renderHtmlToPdfBuffer, sanitizePdfText } from "@/lib/pdf-chrome";',
        'import { blocksToPdfHtml, renderHtmlToPdfBuffer, sanitizePdfText } from "@/lib/pdf-chrome";\nimport { FA_DOC_FONT, adaptTextForBNazanin } from "@/lib/doc-font";',
    )
# Update FA_FONT to use constant
ot = ot.replace(
"""const FA_FONT = {
  ascii: \"B Nazanin\",
  hAnsi: \"B Nazanin\",
  cs: \"B Nazanin\",
  eastAsia: \"B Nazanin\",
};""",
"""const FA_FONT = {
  ascii: FA_DOC_FONT,
  hAnsi: FA_DOC_FONT,
  cs: FA_DOC_FONT,
  eastAsia: FA_DOC_FONT,
};""",
)
# Excel hard-coded cs B Nazanin
ot = ot.replace('cs: "B Nazanin"', "cs: FA_DOC_FONT")

# sanitize body also adapt for nazanin in buildPdf
if "adaptTextForBNazanin(sanitizePdfText(brandForAsk" not in ot:
    ot = ot.replace(
        "const bodyText = sanitizePdfText(brandForAsk(text, userText));",
        "const bodyText = adaptTextForBNazanin(sanitizePdfText(brandForAsk(text, userText)));",
    )

# Also sanitize cleanLine lightly? Apply adapt in cleanLine for all office outputs
if "function cleanLine(line: string)" in ot and "adaptTextForBNazanin" in ot:
    old_cl = """function cleanLine(line: string) {
  return line
    .replace(/\\*\\*(.*?)\\*\\*/g, \"$1\")
    .replace(/__(.*?)__/g, \"$1\")
    .replace(/`/g, \"\")
    .trim();
}"""
    new_cl = """function cleanLine(line: string) {
  return adaptTextForBNazanin(
    line
      .replace(/\\*\\*(.*?)\\*\\*/g, \"$1\")
      .replace(/__(.*?)__/g, \"$1\")
      .replace(/`/g, \"\")
      .trim()
  );
}"""
    if old_cl in ot:
        ot = ot.replace(old_cl, new_cl)
        print("cleanLine adapted")
    else:
        print("cleanLine pattern mismatch - skip")

op.write_text(ot, encoding="utf-8")
print("office ok")

# Excel workbook default font - find buildExcel
idx = ot.find("async function buildExcel")
print("buildExcel at", idx)
snippet = ot[idx:idx+1200]
print(snippet[:800])
