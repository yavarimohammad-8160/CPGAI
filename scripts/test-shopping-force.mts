import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
import {
  isShoppingBrowseAsk,
  isWebRefusal,
  searchWeb,
  formatShoppingFallback,
} from "../src/lib/web-search.ts";

const ask =
  "توی سایت‌های ایرانی بگرد در خصوص فروش اکانت بازی FC27 Ultimate Team بعد ارزان‌ترین سایت رو بهم معرفی کن. سایت‌هایی که قسطی هم میفروشن بهم معرفی کن";
console.log("shopping", isShoppingBrowseAsk(ask));
const soft =
  "لطفاً عبارت زیر را در گوگل سرچ کنید و ۲ الی ۳ سایت برتر را بررسی نمایید";
console.log("refusal soft", isWebRefusal(soft));
const found = await searchWeb(process.env.AVALAI_API_KEY!, ask);
console.log("hits", found.ok ? found.hits.length : found);
if (found.ok) console.log(formatShoppingFallback(found.hits, ask).slice(0, 900));
