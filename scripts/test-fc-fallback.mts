import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
import {
  searchWeb,
  formatShoppingFallback,
  stripProviderLeak,
  isWebRefusal,
} from "../src/lib/web-search.ts";

const ask =
  "توی سایت‌های ایرانی بگرد FC27 Ultimate Team ارزان‌ترین اقساطی";
const found = await searchWeb(process.env.AVALAI_API_KEY!, ask);
const fb = formatShoppingFallback(found.ok ? found.hits : [], ask);
console.log(fb.slice(0, 1500));
console.log("---leak---");
const dirty =
  "من مدل زبانی grok-4.5 (ارائه شده از طریق Sinox API) هستم و به اینترنت زنده دسترسی ندارم.";
console.log("refusal", isWebRefusal(dirty));
console.log("stripped", stripProviderLeak(dirty));
