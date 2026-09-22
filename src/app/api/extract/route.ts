import { NextRequest, NextResponse } from "next/server";
import {
  DIGEST_AFTER,
  SCAN_FAIL_NOTE,
  SCAN_OK_NOTE,
  digestLongPdf,
  ocrPdfPages,
  usefulLength,
} from "@/lib/pdf-extract";
import { getAvalaiClient, getTextClient } from "@/lib/llm";
import {
  extractUploadedBytes,
  READ_OK_NOTE,
} from "@/lib/file-extract";
import { hasContractSignal } from "@/lib/pdf-extract";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "فایل ارسال نشد." },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractUploadedBytes(file.name, file.type, bytes);

    let text = extracted.text;
    let digested = false;
    let note = extracted.note || READ_OK_NOTE;
    let weak = extracted.weak;
    const name = file.name.toLowerCase();
    const isPdf = file.type.includes("pdf") || name.endsWith(".pdf");
    const avalai = getAvalaiClient();
    if (isPdf && (extracted.scanned || usefulLength(text) < 400) && avalai) {
      let ocr = { text: "", pages: extracted.pages || 0, weak: true };
      try {
        ocr = await ocrPdfPages(bytes, avalai.apiKey);
      } catch (err) {
        console.log("PDF_OCR_THROW", err);
      }
      const merged = [extracted.text, ocr.text].filter(Boolean).join("\n\n");
      if (usefulLength(ocr.text) >= 40 || hasContractSignal(merged)) {
        text = extracted.text
          ? extracted.text + "\n\nمتن از صفحات اسکن‌شده:\n\n" + ocr.text
          : "متن از صفحات اسکن‌شده:\n\n" + ocr.text;
        weak = !hasContractSignal(text) && usefulLength(text) < 400;
        note = SCAN_OK_NOTE;
      } else {
        text = extracted.text || "";
        weak = !hasContractSignal(text);
        note = SCAN_FAIL_NOTE;
      }
    }
    if (hasContractSignal(text)) weak = false;
    const textClient = getTextClient();
    if (
      isPdf &&
      !hasContractSignal(text) &&
      usefulLength(text) >= 40 &&
      text.length > DIGEST_AFTER &&
      textClient
    ) {
      const digest = await digestLongPdf(
        textClient.apiKey,
        text,
        textClient.baseUrl,
        textClient.model
      );
      if (digest.length > 200) {
        text =
          "نسخه فشرده سند (عنوان‌ها و بندهای کلیدی):\n\n" +
          digest +
          "\n\n--- آغاز متن خام ---\n" +
          text.slice(0, 14000);
        digested = true;
      }
    }

    return NextResponse.json({
      text,
      pages: extracted.pages,
      digested,
      weak,
      limited: extracted.limited,
      note,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "خطای ناشناخته";
    console.log("EXTRACT_POST_ERROR", err);
    return NextResponse.json({
      text: "",
      weak: true,
      limited: true,
      note: "خواندن فایل انجام نشد: " + message,
    });
  }
}
