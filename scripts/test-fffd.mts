import { stripProviderLeak } from "../src/lib/web-search.ts";

const samples = [
  "من CPGAI هستم و با کمال میل در خدمت شما خواهم بود.",
  "نسخه‌هایی مانند FC 24",
  "عکس را در گوشی یا اپلیکیشن‌هایی مثل InShot",
  "خوشحالم که تجربه خرید و نصب بازی برایتان رضایت‌بخش بوده",
];
for (const s of samples) {
  const out = stripProviderLeak(s);
  console.log({ same: out === s, hasFFFD: out.includes("\uFFFD"), out });
}
