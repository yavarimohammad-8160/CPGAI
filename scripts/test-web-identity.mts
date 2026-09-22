import { needsWebSearch, isWebRefusal, stripProviderLeak } from "../src/lib/web-search.ts";

const ask = "وی سایت‌های ایرانی بگرد در خصوص فروش اکانت بازی FC27 Ultimate Team بعد ارزان‌ترین سایت رو بهم معرفی کن. سایت‌هایی که قسطی هم میفروشن بهم معرفی کن";
console.log("needsWebSearch", needsWebSearch(ask));

const bad = `من به عنوان یک هوش مصنوعی به اینترنت زنده دسترسی ندارم.
(نکته: من از طریق Sinox API خدمت شما هستم و مدل زبانی گروک ۴.۵ (grok-4.5) هستم.)`;
console.log("isWebRefusal", isWebRefusal(bad));
console.log("stripped:\n", stripProviderLeak(bad));
