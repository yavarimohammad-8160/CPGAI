"use strict";

function isAdmin() {
  const args = process.argv.slice(2);
  return (
    process.env.CPGAI_ROLE === "admin" ||
    process.env.CPGAI_ADMIN_REFRESH === "1" ||
    args.includes("--admin")
  );
}

async function main() {
  if (!isAdmin()) {
    console.error("فقط role=admin می‌تواند بانک آمار را به‌روز کند.");
    process.exit(1);
  }

  const base = (process.env.CPGAI_BASE_URL || "http://127.0.0.1:3000").replace(
    /\/+$/,
    ""
  );
  const res = await fetch(base + "/api/admin/stats/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cpgai-role": "admin",
    },
    body: JSON.stringify({ source: "script" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(data.error || "به‌روزرسانی بانک آمار انجام نشد.");
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
