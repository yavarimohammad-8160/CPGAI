import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOLDERS = new Set(["generated", "outputs"]);

function contentType(name: string) {
  const t = String(name || "").toLowerCase();
  if (t.endsWith(".png")) return "image/png";
  if (t.endsWith(".jpg") || t.endsWith(".jpeg")) return "image/jpeg";
  if (t.endsWith(".webp")) return "image/webp";
  if (t.endsWith(".gif")) return "image/gif";
  if (t.endsWith(".pdf")) return "application/pdf";
  if (t.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (t.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (t.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

function safeName(raw: string) {
  let name = String(raw || "");
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep */
  }
  name = path.basename(name).replace(/[\u0000-\u001f]/g, "");
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return "";
  }
  return name;
}

export async function GET(
  _req: NextRequest,
  context: {
    params:
      | Promise<{ folder: string; name: string }>
      | { folder: string; name: string };
  }
) {
  const params = await context.params;
  const folder = String(params.folder || "");
  const name = safeName(params.name || "");
  if (!FOLDERS.has(folder) || !name) {
    return new NextResponse("Not found", { status: 404 });
  }

  const full = path.join(process.cwd(), "public", folder, name);
  const root = path.resolve(process.cwd(), "public", folder);
  const resolved = path.resolve(full);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!existsSync(full)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = readFileSync(full);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentType(name),
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition":
        "inline; filename*=UTF-8''" + encodeURIComponent(name),
    },
  });
}
