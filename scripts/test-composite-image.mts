import {
  isCompositeImageAsk,
  isShowImageAgainAsk,
  isImageEditAsk,
  stripFakeToolJson,
  collectCompositeEditPrompt,
} from "../src/lib/image-work.ts";

const ask = "عکس پسرم رو اینطوری درست کن: لباس زرد رنگ رو تنش کن و بک گراند عکس رو عکس beck_forward.jpg قرار بده . اسم بشه Adrian اعداد همه بشه 100";
console.log("composite", isCompositeImageAsk(ask));
console.log("editAsk+attach", isImageEditAsk(ask, true));
console.log("show again", isShowImageAgainAsk("خب عکسی که درست کردی کو؟"));
console.log("show again2", isShowImageAgainAsk("تصویر نهایی رو مجددا تولید و ارسال کن"));
const leak = `در حال پردازش...\n\n{\"action\": \"edit_image\", \"action_input\": {\"prompt\": \"x\"}}\n`;
console.log("strip", stripFakeToolJson(leak));
console.log("prompt has FACE", /FACE/.test(collectCompositeEditPrompt(ask, 4)));
