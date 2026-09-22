import { renderChartPng } from "../src/lib/chart-render.ts";
import { writeFileSync } from "fs";
const buf = await renderChartPng({
  type: "pie",
  title: "درصد خوراک‌دهی به سنگ‌شکن به تفکیک مبدأ",
  labels: ["خوراک مستقیم", "معدن A10", "دپو مگنت", "دپوی خریداری شده", "ارزش آفرینان", "ریبار"],
  values: [2.5, 9.6, 22.1, 56.9, 8.6, 0.4],
  note: "نمونه تست CPGAI",
});
writeFileSync("C:/Users/yavari/Documents/cpgai-chart-smoke.png", buf);
console.log("png bytes", buf.length);
