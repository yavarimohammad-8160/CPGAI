/** Shared Persian document font for Word / PDF / PPTX / Excel. */
export const FA_DOC_FONT = "B Nazanin";
export const FA_DOC_FONT_FILES = {
  regular: "B-Nazanin-Regular.ttf",
  bold: "B-Nazanin-Bold.ttf",
} as const;

/** Characters B Nazanin often lacks — map to safe ASCII/Persian equivalents. */
export function adaptTextForBNazanin(input: string): string {
  return String(input || "")
    .replace(/\u066A/g, "%") // Arabic percent → %
    .replace(/\u066B/g, ".") // Arabic decimal separator
    .replace(/\u066C/g, ",") // Arabic thousands separator
    .replace(/[\u2013\u2014\u2212]/g, "-") // en/em/minus dashes
    .replace(/\u2026/g, "...");
}
