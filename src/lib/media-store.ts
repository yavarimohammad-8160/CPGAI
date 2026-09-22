import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export function isPublicMediaPath(src?: string) {
  return /^\/(?:api\/media\/)?(generated|outputs)\//.test(String(src || ""));
}

export function toApiMediaUrl(src?: string) {
  const s = String(src || "").split("?")[0];
  const m = s.match(/^\/(?:api\/media\/)?(generated|outputs)\/([^/]+)$/);
  if (!m) return s;
  return "/api/media/" + m[1] + "/" + m[2];
}

export function mediaDiskPath(src?: string) {
  const s = String(src || "").split("?")[0];
  const m = s.match(/^\/(?:api\/media\/)?(generated|outputs)\/([^/]+)$/);
  if (!m) return "";
  let name = m[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep */
  }
  name = basename(name);
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return "";
  }
  const folder = m[1];
  const full = join(process.cwd(), "public", folder, name);
  const root = resolve(process.cwd(), "public", folder);
  const resolved = resolve(full);
  if (resolved !== root && !resolved.startsWith(root + sep)) return "";
  return full;
}

export function savePublicFile(
  folder: "generated" | "outputs",
  fileName: string,
  buffer: Buffer
) {
  if (!buffer || buffer.length < 1) {
    throw new Error("بافر فایل خالی است");
  }
  try {
    const dir = join(process.cwd(), "public", folder);
    mkdirSync(dir, { recursive: true });
    const full = join(dir, fileName);
    writeFileSync(full, buffer);
    const exists = existsSync(full);
    console.log("FILE_EXISTS", exists, full);
    if (!exists || statSync(full).size < 1) {
      throw new Error("نوشتن فایل انجام نشد: " + full);
    }
    const url = "/api/media/" + folder + "/" + encodeURIComponent(fileName);
    console.log("SAVED_FILE", url, existsSync(full));
    return url;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

export function bufferFromDataUrlOrB64(input: string) {
  const src = String(input || "").trim();
  if (!src) return null;
  try {
    let raw = src;
    if (src.startsWith("data:")) {
      if (!src.includes(",")) return null;
      raw = src.slice(src.indexOf(",") + 1);
    } else if (!(src.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(src.slice(0, 80)))) {
      return null;
    }
    const buf = Buffer.from(raw.replace(/\s/g, ""), "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function extFromMime(mime: string, fallback = ".bin") {
  const t = String(mime || "").toLowerCase();
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("webp")) return ".webp";
  if (t.includes("gif")) return ".gif";
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("wordprocessing") || t.includes("msword")) return ".docx";
  if (t.includes("presentation")) return ".pptx";
  if (t.includes("spreadsheet") || t.includes("excel")) return ".xlsx";
  return fallback;
}

function safeFileName(name: string, ext: string) {
  const base = String(name || "cpgai-output")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.[a-z0-9]+$/i, "")
    .slice(0, 60);
  return (base || "cpgai-output") + ext;
}

export function persistGeneratedImage(image: string) {
  const src = String(image || "");
  if (!src) return "";
  if (isPublicMediaPath(src)) return toApiMediaUrl(src);
  const buf = bufferFromDataUrlOrB64(src);
  if (!buf) return "";
  try {
    const name = "img-" + Date.now() + ".png";
    return savePublicFile("generated", name, buf);
  } catch (err) {
    console.log("SAVE_IMAGE_FAIL", err);
    return "";
  }
}

export function persistOutputFile(opts: {
  fileName?: string;
  fileBase64?: string;
  fileMime?: string;
  fileUrl?: string;
  kind?: string;
}) {
  const currentUrl = String(opts.fileUrl || "");
  if (isPublicMediaPath(currentUrl)) {
    const url = toApiMediaUrl(currentUrl);
    return {
      name: opts.fileName || currentUrl.split("/").pop() || "output",
      url,
      mime: opts.fileMime || "",
      fileName: opts.fileName || currentUrl.split("/").pop() || "output",
      fileUrl: url,
      fileMime: opts.fileMime || "",
    };
  }
  const fromData = currentUrl.startsWith("data:")
    ? bufferFromDataUrlOrB64(currentUrl)
    : null;
  const buffer = opts.fileBase64
    ? Buffer.from(opts.fileBase64, "base64")
    : fromData;
  if (!buffer || !buffer.length) {
    throw new Error("داده فایل برای ذخیره روی دیسک موجود نیست.");
  }
  const mime = opts.fileMime || "application/octet-stream";
  const fromName = (opts.fileName || "").match(/(\.[a-z0-9]+)$/i)?.[1];
  const ext =
    fromName ||
    extFromMime(mime, opts.kind === "pptx" ? ".pptx" : opts.kind === "pdf" ? ".pdf" : opts.kind === "xlsx" ? ".xlsx" : ".docx");
  const name = opts.fileName
    ? safeFileName(opts.fileName, ext)
    : "cpgai-" + (opts.kind || "file") + "-" + Date.now() + ext;
  const url = savePublicFile("outputs", name, buffer);
  return {
    name: opts.fileName || name,
    url,
    mime,
    fileName: opts.fileName || name,
    fileUrl: url,
    fileMime: mime,
  };
}

export async function persistMessageMedia(msg: {
  image?: string;
  images?: string[];
  fileName?: string;
  fileUrl?: string;
  fileMime?: string;
  fileBase64?: string;
}) {
  const incoming = [
    msg.image || "",
    ...(Array.isArray(msg.images) ? msg.images : []),
  ].filter(Boolean);
  const saved: string[] = [];
  for (const src of incoming) {
    let image = src;
    if (image.startsWith("data:image")) {
      image = persistGeneratedImage(image);
    } else if (image.startsWith("data:")) {
      image = "";
    } else if (isPublicMediaPath(image)) {
      image = toApiMediaUrl(image);
    }
    if (image && !saved.includes(image)) saved.push(image);
  }
  let image = saved[0] || "";
  let fileUrl = msg.fileUrl || "";
  let fileName = msg.fileName || "";
  let fileMime = msg.fileMime || "";
  if (
    fileUrl.startsWith("data:") ||
    (msg.fileBase64 && !isPublicMediaPath(fileUrl))
  ) {
    try {
      const stored = persistOutputFile({
        fileName,
        fileBase64: msg.fileBase64,
        fileMime,
        fileUrl,
      });
      fileUrl = stored.url;
      fileName = stored.name;
      fileMime = stored.mime;
    } catch (err) {
      console.log("SAVE_FILE_FAIL", err);
      fileUrl = "";
    }
  }
  if (image.startsWith("data:")) image = "";
  if (fileUrl.startsWith("data:")) fileUrl = "";
  if (isPublicMediaPath(image)) image = toApiMediaUrl(image);
  if (isPublicMediaPath(fileUrl)) fileUrl = toApiMediaUrl(fileUrl);
  const images = saved
    .map((src) => (isPublicMediaPath(src) ? toApiMediaUrl(src) : src))
    .filter((src) => src && !src.startsWith("data:"));
  return { image, images, fileUrl, fileName, fileMime };
}
