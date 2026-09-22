import { writeFileSync } from "fs";
import { buildOfficeFile } from "../src/lib/office.ts";
import { makeProfessionalPptx } from "../src/lib/make-pptx.ts";

const sample = `گزارش عملکرد سازمانی شرکت سی‌پی‌جی پارس
سال مالی ۱۴۰۴

## مقدمه و چشم‌انداز کلان
کنترل دقیق هزینه‌ها و تأمین کالا و اطلاعات مدیریتی در سال ۱۴۰۴.

| شاخص | هدف | تحقق |
| پیشرفت پروژه‌ها | ۸۵% | ۸۸% |
| رضایت مشتری | ۹۰% | ۹۲% |
`;

const pdf = await buildOfficeFile("pdf", sample, "گزارش عملکرد سازمانی PDF");
writeFileSync("D:/Projects/cpgai/.tmp-bnazanin.pdf", Buffer.from(pdf.fileBase64, "base64"));
writeFileSync(process.env.USERPROFILE + "/Documents/cpgai-bnazanin.pdf", Buffer.from(pdf.fileBase64, "base64"));
console.log("pdf", pdf.fileName, pdf.fileMime);

const docx = await buildOfficeFile("docx" as any, sample, "گزارش عملکرد سازمانی Word");
// kind might be "word"
const word = await buildOfficeFile("word", sample, "گزارش عملکرد سازمانی Word");
writeFileSync("D:/Projects/cpgai/.tmp-bnazanin.docx", Buffer.from(word.fileBase64, "base64"));
writeFileSync(process.env.USERPROFILE + "/Documents/cpgai-bnazanin.docx", Buffer.from(word.fileBase64, "base64"));
console.log("word", word.fileName);

const pptx = await makeProfessionalPptx({
  title: "گزارش عملکرد سازمانی",
  subtitle: "سال ۱۴۰۴",
  slides: [
    { title: "خلاصه مدیریتی", bullets: ["رشد درآمد", "بهبود رضایت مشتری", "کنترل دقیق هزینه"] },
    { title: "اقدامات", bullets: ["توسعه بازار", "تأمین کالا", "اطلاعات شفاف"] },
  ],
  fileBaseName: "ارائه-عملکرد-بنزنین",
  topic: "عملکرد",
  rtl: true,
  audience: "org",
});
writeFileSync("D:/Projects/cpgai/.tmp-bnazanin.pptx", Buffer.from(pptx.fileBase64, "base64"));
writeFileSync(process.env.USERPROFILE + "/Documents/cpgai-bnazanin.pptx", Buffer.from(pptx.fileBase64, "base64"));
console.log("pptx", pptx.fileName);
