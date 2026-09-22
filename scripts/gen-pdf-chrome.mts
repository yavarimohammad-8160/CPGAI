import { readFileSync, writeFileSync } from "fs";
import { buildOfficeFile } from "../src/lib/office";

async function main() {
  const body = readFileSync("C:/Users/yavari/agent-tools/cpgai-sample-body.txt", "utf8");
  const ask = "یک گزارش عملکرد سازمانی PDF برای سی‌پی‌جی پارس با نام گزارش-عملکرد-1404 بساز";
  console.log("building...");
  const file = await buildOfficeFile("pdf", body, ask);
  const buf = Buffer.from(file.fileBase64, "base64");
  const out = "C:/Users/yavari/agent-tools/cpgai-pdf-chrome-sample.pdf";
  writeFileSync(out, buf);
  console.log("WROTE", out, "name=", file.fileName, "bytes=", buf.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
