import { writeFileSync } from "fs";
import { buildOfficeFile } from "../src/lib/office.ts";

const weird = String.fromCodePoint(0x100519);
const sample = `گزارش عملکرد سازمانی شرکت سی‌پی‌جی پارس
سال مالی ۱۴۰۴

## ۱. مقدمه و چشم‌انداز کلان سازمانی
شرکت با تکیه بر دانش فنی، کنترل دقیق هزینه‌ها و تنوع‌بخشی به منابع تأمین کالا و تجهیزات در سال ۱۴۰۴ عمل کرد.
اطلاعات بالایی از عملکرد نشان می‌دهد کالا و کلان‌پروژه‌ها رشد داشته‌اند.

## ۲. جدول
| عنوان شاخص کلیدی عملکرد | هدف تعیین‌شده (۱۴۰۴) | مقدار تحقق‌یافته | درصد تحقق | وضعیت عملکرد |
| درصد پیشرفت میانگین پروژه‌های فعال | ۸۵٪ | ${weird}${weird}۸ | ۱۰۳.۵٪ | فراتر از انتظار |
| شاخص انحراف زمان‌بندی پروژه (SPI) | ۱.۰۰ | ۱.۰۴ | ۱۰۴.۰٪ | مطلوب |
| نرخ رضایت | ۸۵٪ | ۸۸٪ | ۱۰۳.۵٪ | فراتر از انتظار |
`;

const out = await buildOfficeFile(
  "pdf",
  sample,
  "گزارش عملکرد سازمانی سی‌پی‌جی پارس سال ۱۴۰۴ PDF"
);
const buf = Buffer.from(out.fileBase64, "base64");
writeFileSync("D:/Projects/cpgai/.tmp-sanitize-test.pdf", buf);
writeFileSync(
  process.env.USERPROFILE + "/Documents/cpgai-sanitize-test.pdf",
  buf
);
console.log("name", out.fileName, "bytes", buf.length);
