import {
  parseTextSwapAsk,
  isEditRetryAsk,
  collectEditPrompt,
  askOnly,
} from "../src/lib/image-work.ts";

const samples = [
  "خط اول داخل پرانتز میتا رو بکن مپتا",
  'هنوز میتا هست ببین قرمز نوشته "میتا" همون رو بدون تغییر دیگه ای بکن "مپتا"',
  "نشد",
];
for (const s of samples) {
  console.log(JSON.stringify({ s: s.slice(0, 40), swap: parseTextSwapAsk(s), retry: isEditRetryAsk(s) }));
}
const p = collectEditPrompt(samples[0]);
console.log("no font change rule:", /Do NOT change fonts/.test(p));
console.log("askOnly export:", askOnly("  hi  "));
