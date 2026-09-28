export const FILE_SOURCE_EACH_CAP = 70000;
export const FILE_SOURCE_TOTAL_CAP = 40000;

export type PackedFileSources = {
  dump: string;
  count: number;
  names: string[];
  charsEach: number[];
  failed: string[];
};

export function packFileSources(
  files: Array<{ name?: string; text?: string }> | undefined
): PackedFileSources {
  const rows = Array.isArray(files) ? files : [];
  const names: string[] = [];
  const charsEach: number[] = [];
  const failed: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const row of rows) {
    const name = String(row?.name || "فایل").trim() || "فایل";
    names.push(name);
    const raw = String(row?.text || "").trim();
    if (!raw) {
      failed.push(name);
      charsEach.push(0);
      continue;
    }
    const sliced = raw.slice(0, FILE_SOURCE_EACH_CAP);
    const room = FILE_SOURCE_TOTAL_CAP - used;
    if (room <= 0) {
      charsEach.push(0);
      continue;
    }
    const take = sliced.slice(0, room);
    parts.push("--- فایل: " + name + " ---\n" + take);
    charsEach.push(take.length);
    used += take.length;
  }
  return {
    dump: parts.join("\n\n"),
    count: rows.length,
    names,
    charsEach,
    failed,
  };
}
