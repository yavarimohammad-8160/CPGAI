import { readFileSync, writeFileSync } from "fs";
import { buildOfficeFile } from "../src/lib/office";
import { makeProfessionalPptx } from "../src/lib/make-pptx";

async function main() {
  const body = readFileSync("C:/Users/yavari/agent-tools/cpgai-sample-body.txt", "utf8");
  const ask = "یک گزارش عملکرد سازمانی برای سی‌پی‌جی پارس بساز";

  console.log("building word...");
  const word = await buildOfficeFile("word", body, ask);
  writeFileSync(
    "C:/Users/yavari/agent-tools/cpgai-word-sample.docx",
    Buffer.from(word.fileBase64, "base64")
  );
  console.log("WORD", word.fileName);

  console.log("building pptx...");
  const pptx = await makeProfessionalPptx({
    title: "گزارش عملکرد سالانه سی‌پی‌جی پارس",
    subtitle: "سال ۱۴۰۴ — سند سازمانی",
    fileBaseName: "ارائه-عملکرد-1404",
    audience: "org",
    rtl: true,
    slides: [
      {
        title: "چشم‌انداز و اولویت‌ها",
        bullets: [
          "تکیه بر دانش فنی متخصصان داخلی",
          "نوآوری در تولید و توزیع",
          "توسعه استراتژی‌های بازارمحور",
          "دیجیتال‌سازی فرآیندها",
        ],
      },
      {
        title: "شاخص‌های کلیدی",
        bullets: [
          "رشد حجم تولید: ۱۸.۲٪ در برابر هدف ۱۵٪",
          "کاهش ضایعات به ۲.۸٪",
          "رضایت مشتریان (CSAT): ۸۸.۴٪",
          "تحویل به‌موقع سفارش‌ها: ۹۴.۱٪",
        ],
      },
      {
        title: "اقدامات بعدی",
        bullets: [
          "توسعه محصولات دانش‌بنیان",
          "گسترش صادرات منطقه‌ای",
          "هوشمندسازی زنجیره ارزش",
        ],
      },
    ],
  });
  writeFileSync(
    "C:/Users/yavari/agent-tools/cpgai-pptx-sample.pptx",
    pptx.buffer || Buffer.from(pptx.fileBase64, "base64")
  );
  console.log("PPTX", pptx.fileName);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
