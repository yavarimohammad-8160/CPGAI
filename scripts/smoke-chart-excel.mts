import { buildChartExcel, isChartExcelAsk } from "../src/lib/chart-render.ts";
import { writeFileSync } from "fs";
console.log(isChartExcelAsk("همین عکس رو بصورت اکسل بده"));
console.log(isChartExcelAsk("نمودار رو اکسل بده"));
const built = await buildChartExcel({
  type: "pie",
  title: "خوراک سنگ‌شکن",
  labels: ["خوراک مستقیم", "معدن A10", "دپو مگنت", "دپوی خریداری شده"],
  values: [2.5, 9.6, 22.1, 56.9],
  note: "تست",
});
writeFileSync("C:/Users/yavari/Documents/cpgai-chart.xlsx", Buffer.from(built.fileBase64, "base64"));
console.log(built.fileName, built.fileBase64.length);
