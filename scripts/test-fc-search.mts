import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
import { searchWeb, needsWebSearch } from "../src/lib/web-search.ts";
import { getAvalaiClient } from "../src/lib/llm.ts";
const ask = "توی سایت‌های ایرانی بگرد در خصوص فروش اکانت بازی FC27 Ultimate Team بعد ارزان‌ترین سایت رو بهم معرفی کن. سایت‌هایی که قسطی هم میفروشن بهم معرفی کن";
console.log("needs", needsWebSearch(ask));
const avalai = getAvalaiClient();
console.log("avalai", !!avalai, avalai?.apiKey ? "keylen="+avalai.apiKey.length : "");
const found = await searchWeb(avalai!.apiKey, ask);
console.log(JSON.stringify(found, null, 2).slice(0, 2500));
