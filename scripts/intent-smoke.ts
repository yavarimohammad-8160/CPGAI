import { resolveIntent } from "../src/lib/intent";

const cscu = `# CSCU
Certified Secure Computer User
Module 1: Passwords and phishing
Flash drives and malware`;

const cases: {
  name: string;
  text: string;
  want: {
    type?: string;
    format?: string;
    topic?: string;
    convertSame?: boolean;
  };
}[] = [
  {
    name: "visual pptx from CSCU",
    text:
      "از روی این فایل پاورپوینت قوی و خوشگل بساز و عکس داشته باشه\nمحتوای فایل:\n" +
      cscu,
    want: { type: "presentation", format: "pptx", topic: "CSCU" },
  },
  {
    name: "convert same pdf",
    text: "همین را PDF کن",
    want: { format: "pdf", convertSame: true },
  },
  {
    name: "performance only when asked",
    text: "فایل گزارش عملکرد سالانه بساز",
    want: { type: "performance" },
  },
  {
    name: "CSCU pdf is training not performance",
    text: "از این فایل PDF بساز\nمحتوای فایل:\n" + cscu,
    want: { type: "training", format: "pdf", topic: "CSCU" },
  },
  {
    name: "resume",
    text: "فایل رزومه برای بازار کار بساز",
    want: { type: "resume", format: "docx" },
  },
  {
    name: "job profile",
    text: "فایل شناسنامه شغلی کارشناس نظارت بده",
    want: { type: "job_profile" },
  },
  {
    name: "chat question",
    text: "چرا GPO عوض شده",
    want: { type: "chat", format: "chat" },
  },
  {
    name: "image only",
    text: "یه عکس از کوره بساز",
    want: { type: "image", format: "image" },
  },
  {
    name: "quality words not in filename",
    text: "از این فایل ارائه قوی و خوشگل بساز\nمحتوای فایل:\n" + cscu,
    want: { type: "presentation", format: "pptx" },
  },
  {
    name: "contract inspect is chat",
    text: "این فایل را بررسی کن\nمحتوای فایل:\nArticle 1\nThis agreement...",
    want: { type: "chat", format: "chat" },
  },
  {
    name: "contract to word",
    text: "از روی این فایل ورد بساز\nمحتوای فایل:\nArticle 1\nThis agreement...",
    want: { type: "from_source", format: "docx" },
  },
];

cases.push(...["سلام","آموزش برنامه نویسی بده","این متن را ترجمه کن","به صورت مرحله به مرحله توضیح بده","دستورات ترمینال نصب ورد را بنویس","چرا فایل DOCX باز نمی شود؟","چطور فایل PPTX بسازم؟","متن ارائه درباره امنیت بنویس","شناسنامه شغلی کارشناس بده","رزومه برای بازار کار بساز","گزارش عملکرد سالانه بده","فایل ورد نساز، فقط متن بده","همین متن را خلاصه کن","What is the difference between DOCX and PPTX?","Show me code to create a DOCX file","How do I create a Word document?","Create a DOCX file? No file, text only.","این فایل را بررسی کن\nمحتوای فایل:\nفایل پاورپوینت بساز"].map(text => ({name: text, text, want: {type: 'chat', format: 'chat'}})));
cases.push(...["فایل ورد بساز","یک پاورپوینت درباره امنیت بساز","این متن را DOCX کن","فایل بده","یک سند ایجاد کن","Create a DOCX file about security","Make a PowerPoint presentation","خروجی ورد بده","این گزارش را در قالب PDF بده","فایل اسکریپت سخنرانی بساز"].map(text => ({name: text, text, want: {format: /pptx|پاورپوینت|PowerPoint/i.test(text) ? 'pptx' : /pdf/i.test(text) ? 'pdf' : 'docx'}})));
cases.push(...[
  "در مورد برنامه نویسی توضیح بده",
  "این فایل را توضیح بده",
  "فایل Word را خلاصه کن",
  "درباره سند راهنمایی بده",
].map(text => ({ name: text, text, want: { type: "chat", format: "chat" } })));
cases.push({name: "explicit training file", text: "فایل آموزش امنیت بساز", want: {format: "docx"}});
let failed = 0;
for (const row of cases) {
  const got = resolveIntent(row.text);
  const bad: string[] = [];
  if (row.want.type && got.type !== row.want.type) bad.push("type=" + got.type);
  if (row.want.format && got.format !== row.want.format) {
    bad.push("format=" + got.format);
  }
  if (row.want.topic && got.topic !== row.want.topic) {
    bad.push("topic=" + got.topic);
  }
  if (row.want.convertSame && !got.convertSame) bad.push("convertSame=false");
  if (
    /آماده-شده-بصورت-بفرست|گفتم-فایل-بفرست|گزارش-عملکرد-سالانه-نمونه|قوی|خوشگل/.test(
      got.fileName
    )
  ) {
    bad.push("junk fileName=" + got.fileName);
  }
  if (bad.length) {
    failed += 1;
    console.log("FAIL", row.name, bad.join(", "), {
      type: got.type,
      format: got.format,
      topic: got.topic,
      fileName: got.fileName,
      sourceChars: got.sourceChars,
      convertSame: got.convertSame,
    });
  } else {
    console.log("OK", row.name, {
      type: got.type,
      format: got.format,
      topic: got.topic,
      fileName: got.fileName,
      sourceChars: got.sourceChars,
    });
  }
}

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("ALL_OK");
