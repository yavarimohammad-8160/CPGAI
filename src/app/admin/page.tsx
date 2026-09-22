"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";

type UserRole = "admin" | "user";

type PublicUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  monthly_token_limit?: number;
  monthly_image_limit?: number;
  monthly_file_limit?: number;
  limits_enabled?: boolean;
};

type MemoryRow = {
  id: string;
  username: string;
  scope: string;
  topic: string;
  content: string;
  created_at: string;
};

type UsageRange = "today" | "7d" | "30d";

type UsageSummary = {
  chats: number;
  images: number;
  files: number;
  tokens: number;
  cost: number;
};

type UsageUser = {
  username: string;
  name: string;
  chats: number;
  images: number;
  files: number;
  tokens: number;
  cost: number;
  lastAt: string;
  monthTokens?: number;
  monthImages?: number;
  monthFiles?: number;
  tokenLimit?: number;
  imageLimit?: number;
  fileLimit?: number;
  limitsEnabled?: boolean;
};

function getStoredUser() {
  return localStorage.getItem("cpgai-user") || "";
}

function getStoredRole() {
  return localStorage.getItem("cpgai-role") || "";
}

function getStoredName() {
  const name = (localStorage.getItem("cpgai-name") || "").trim();
  return name || getStoredUser();
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "x-cpgai-role": localStorage.getItem("cpgai-role") || "",
    "x-cpgai-user": localStorage.getItem("cpgai-user") || "",
  };
}

export default function AdminPage() {
  const router = useRouter();
  const username = useSyncExternalStore(
    () => () => {},
    getStoredUser,
    () => ""
  );
  const role = useSyncExternalStore(
    () => () => {},
    getStoredRole,
    () => ""
  );
  const displayName = useSyncExternalStore(
    () => () => {},
    getStoredName,
    () => ""
  );

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");
  const [pwDraft, setPwDraft] = useState<Record<string, string>>({});
  const [limitDraft, setLimitDraft] = useState<
    Record<string, { tokens: string; images: string; files: string }>
  >({});
  const [statsJson, setStatsJson] = useState("");
  const [statsNote, setStatsNote] = useState("");
  const [statsSaving, setStatsSaving] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsDue, setStatsDue] = useState(false);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memDraft, setMemDraft] = useState("");
  const [memNote, setMemNote] = useState("");
  const [usageRange, setUsageRange] = useState<UsageRange>("7d");
  const [usageSummary, setUsageSummary] = useState<UsageSummary>({
    chats: 0,
    images: 0,
    files: 0,
    tokens: 0,
    cost: 0,
  });
  const [usageUsers, setUsageUsers] = useState<UsageUser[]>([]);
  const [usageNote, setUsageNote] = useState("");

  useEffect(() => {
    if (!username) {
      router.replace("/");
      return;
    }
    if (role !== "admin") {
      router.replace("/chat");
    }
  }, [username, role, router]);

  useEffect(() => {
    if (role !== "admin") return;

    async function loadUsers() {
      try {
        const res = await fetch("/api/users", { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "خواندن کاربران ممکن نشد.");
          return;
        }
        setUsers(data.users || []);
      } catch {
        setError("ارتباط با سرور برقرار نشد.");
      }
    }

    void loadUsers();

    async function loadStats() {
      try {
        const res = await fetch("/api/steel-stats", { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) {
          setStatsNote(data.error || "خواندن بانک آمار ممکن نشد.");
          return;
        }
        setStatsJson(JSON.stringify(data.stats, null, 2));
        setStatsNote("به‌روزرسانی: " + (data.stats?.updatedAt || ""));
        try {
          const statusRes = await fetch("/api/admin/stats/refresh", {
            headers: adminHeaders(),
          });
          const status = await statusRes.json();
          if (statusRes.ok) {
            setStatsDue(!!status.due);
            if (status.lastRefreshAt) {
              setStatsNote(
                "به‌روزرسانی: " +
                  (data.stats?.updatedAt || "") +
                  " · آخرین تلاش refresh: " +
                  String(status.lastRefreshAt).slice(0, 10)
              );
            }
          }
        } catch {
          // ignore status probe
        }
      } catch {
        setStatsNote("ارتباط با سرور برقرار نشد.");
      }
    }

    void loadStats();

    async function loadMemories() {
      try {
        const res = await fetch("/api/memory?scope=org", {
          headers: adminHeaders(),
        });
        const data = await res.json();
        if (res.ok) setMemories(data.memories || []);
      } catch {
        // پنل حافظه اختیاری است
      }
    }
    void loadMemories();
  }, [role]);

  useEffect(() => {
    if (role !== "admin") return;
    async function loadUsage() {
      try {
        const res = await fetch("/api/admin/usage?range=" + usageRange, {
          headers: adminHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
          setUsageNote(data.error || "خواندن مصرف ممکن نشد.");
          return;
        }
        setUsageSummary({
          chats: data.summary?.chats || 0,
          images: data.summary?.images || 0,
          files: data.summary?.files || 0,
          tokens: data.summary?.tokens || 0,
          cost: data.summary?.cost || 0,
        });
        setUsageUsers(Array.isArray(data.users) ? data.users : []);
        setUsageNote("");
      } catch {
        setUsageNote("ارتباط با سرور برقرار نشد.");
      }
    }
    void loadUsage();
  }, [role, usageRange]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          name,
          username: newUsername,
          password,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ساخت کاربر انجام نشد.");
        return;
      }
      setUsers((prev) => [...prev, data.user]);
      setName("");
      setNewUsername("");
      setPassword("");
      setNewRole("user");
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: PublicUser) {
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ id: user.id, active: !user.active }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "تغییر وضعیت انجام نشد.");
        return;
      }
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? data.user : item))
      );
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    }
  }

  function limitFields(user: PublicUser) {
    return (
      limitDraft[user.id] || {
        tokens: String(user.monthly_token_limit ?? 300000),
        images: String(user.monthly_image_limit ?? 30),
        files: String(user.monthly_file_limit ?? 40),
      }
    );
  }

  function patchLimit(
    user: PublicUser,
    key: "tokens" | "images" | "files",
    value: string
  ) {
    const current = limitFields(user);
    setLimitDraft((prev) => ({
      ...prev,
      [user.id]: { ...current, [key]: value },
    }));
  }

  async function saveLimits(user: PublicUser) {
    const draft = limitFields(user);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({
          id: user.id,
          monthly_token_limit: draft.tokens,
          monthly_image_limit: draft.images,
          monthly_file_limit: draft.files,
          limits_enabled: user.role === "admin" ? true : user.limits_enabled !== false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ذخیره سقف انجام نشد.");
        return;
      }
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? data.user : item))
      );
      setLimitDraft((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    }
  }

  async function changePassword(id: string) {
    const nextPassword = (pwDraft[id] || "").trim();
    if (!nextPassword) {
      setError("رمز جدید را وارد کنید.");
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ id, password: nextPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "تغییر رمز انجام نشد.");
        return;
      }
      setPwDraft((prev) => ({ ...prev, [id]: "" }));
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    }
  }

  async function removeUser(user: PublicUser) {
    if (!window.confirm("کاربر «" + user.username + "» حذف شود؟")) return;
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: adminHeaders(),
        body: JSON.stringify({ id: user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "حذف کاربر انجام نشد.");
        return;
      }
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    }
  }

  async function refreshStats() {
    setStatsRefreshing(true);
    setStatsNote("در حال جستجوی ارقام جدید از منابع عمومی/کدال...");
    try {
      const res = await fetch("/api/admin/stats/refresh", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ source: "admin-api" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatsNote(data.error || "به‌روزرسانی انجام نشد.");
        return;
      }
      setStatsDue(!!data.due && !data.applied?.length);
      const applied = Array.isArray(data.applied) ? data.applied.length : 0;
      setStatsNote(
        (data.reminder ? data.reminder + " " : "") +
          (data.note || "refresh انجام شد.") +
          (applied ? " موارد اعمال‌شده: " + applied : "")
      );
      const reload = await fetch("/api/steel-stats", { headers: adminHeaders() });
      const body = await reload.json();
      if (reload.ok && body.stats) {
        setStatsJson(JSON.stringify(body.stats, null, 2));
      }
    } catch {
      setStatsNote("ارتباط با سرور برقرار نشد.");
    } finally {
      setStatsRefreshing(false);
    }
  }

  async function saveStats() {
    setStatsSaving(true);
    setStatsNote("");
    try {
      const parsed = JSON.parse(statsJson);
      const res = await fetch("/api/steel-stats", {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ stats: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatsNote(data.error || "ذخیره بانک آمار انجام نشد.");
        return;
      }
      setStatsJson(JSON.stringify(data.stats, null, 2));
      setStatsNote("ذخیره شد. به‌روزرسانی: " + (data.stats?.updatedAt || ""));
    } catch {
      setStatsNote("JSON نامعتبر است یا ارتباط برقرار نشد.");
    } finally {
      setStatsSaving(false);
    }
  }

  async function addOrgMemory(event: React.FormEvent) {
    event.preventDefault();
    const content = memDraft.trim();
    if (!content) return;
    setMemNote("");
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ content, scope: "org" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMemNote(data.error || "ذخیره نشد.");
        return;
      }
      setMemDraft("");
      setMemories((prev) => [data.memory, ...prev].slice(0, 50));
    } catch {
      setMemNote("ارتباط با سرور برقرار نشد.");
    }
  }

  async function removeMemory(id: string) {
    try {
      const res = await fetch("/api/memory?id=" + encodeURIComponent(id), {
        method: "DELETE",
        headers: adminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setMemNote(data.error || "حذف نشد.");
        return;
      }
      setMemories((prev) => prev.filter((row) => row.id !== id));
    } catch {
      setMemNote("ارتباط با سرور برقرار نشد.");
    }
  }

  function faNum(n: number) {
    return Number(n || 0).toLocaleString("fa-IR");
  }

  function formatLast(value: string) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("fa-IR");
  }

  function quotaCell(used: number, limit: number, enabled: boolean) {
    if (!enabled) return <span className="text-slate-400">بدون سقف</span>;
    const ratio = limit > 0 ? used / limit : 1;
    const color =
      ratio >= 1
        ? "text-red-600"
        : ratio >= 0.8
          ? "text-amber-700"
          : "text-[#0f2744]";
    return (
      <span className={color}>
        {faNum(used)} / {faNum(limit)}
      </span>
    );
  }

  function logout() {
    localStorage.removeItem("cpgai-user");
    localStorage.removeItem("cpgai-role");
    localStorage.removeItem("cpgai-name");
    router.replace("/");
  }

  if (!username || role !== "admin") return null;

  return (
    <main className="cpg-bg mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between rounded-3xl bg-white px-5 py-4 shadow-sm">
        <BrandMark subtitle={"کاربران · " + (displayName || username)} />
        <div className="flex items-center gap-2">
          <Link href="/chat" className="rounded-xl px-3 py-2 text-sm text-slate-500">
            چت
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-xl px-3 py-2 text-sm text-slate-500"
          >
            خروج
          </button>
        </div>
      </header>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0f2744]">ساخت کاربر جدید</h2>
        <form onSubmit={createUser} className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-600">نام</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600">یوزرنیم</label>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600">رمز</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600">نقش</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <option value="user">کاربر</option>
              <option value="admin">ادمین</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
            >
              {saving ? "در حال ذخیره..." : "ساخت کاربر"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0f2744]">لیست کاربران</h2>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-2xl bg-slate-50 px-4 py-3"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-[#0f2744]">{user.name}</p>
                <p className="text-sm text-slate-500">
                  {user.username} · {user.role === "admin" ? "ادمین" : "کاربر"} · {user.active ? "فعال" : "غیرفعال"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={pwDraft[user.id] || ""}
                  onChange={(e) =>
                    setPwDraft((prev) => ({ ...prev, [user.id]: e.target.value }))
                  }
                  placeholder="رمز جدید"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => changePassword(user.id)}
                  className="rounded-xl bg-white px-3 py-2 text-sm"
                >
                  تغییر رمز
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(user)}
                  className="rounded-xl bg-white px-3 py-2 text-sm"
                >
                  {user.active ? "غیرفعال" : "فعال"}
                </button>
                <button
                  type="button"
                  onClick={() => removeUser(user)}
                  className="rounded-xl px-3 py-2 text-sm text-red-600"
                >
                  حذف
                </button>
              </div>
              </div>
              {user.role === "admin" && user.limits_enabled !== true ? (
                <p className="text-xs text-slate-400">ادمین سقف ماهانه ندارد.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-500">
                    توکن
                    <input
                      type="number"
                      min={0}
                      value={limitFields(user).tokens}
                      onChange={(e) => patchLimit(user, "tokens", e.target.value)}
                      className="mt-1 w-28 rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    عکس
                    <input
                      type="number"
                      min={0}
                      value={limitFields(user).images}
                      onChange={(e) => patchLimit(user, "images", e.target.value)}
                      className="mt-1 w-20 rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    فایل
                    <input
                      type="number"
                      min={0}
                      value={limitFields(user).files}
                      onChange={(e) => patchLimit(user, "files", e.target.value)}
                      className="mt-1 w-20 rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => saveLimits(user)}
                    className="rounded-xl bg-white px-3 py-2 text-sm"
                  >
                    ذخیره سقف
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-[#0f2744]">مصرف</h2>
          <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 text-sm">
            {(
              [
                ["today", "امروز"],
                ["7d", "۷ روز"],
                ["30d", "۳۰ روز"],
              ] as Array<[UsageRange, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setUsageRange(key)}
                className={
                  "rounded-xl px-3 py-1.5 " +
                  (usageRange === key
                    ? "bg-white text-[#0f2744] shadow-sm"
                    : "text-slate-500")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {usageNote && <p className="mb-3 text-sm text-red-600">{usageNote}</p>}
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["پیام‌ها", usageSummary.chats],
            ["عکس", usageSummary.images],
            ["فایل", usageSummary.files],
            ["توکن", usageSummary.tokens],
            ["هزینه تخمینی", usageSummary.cost],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-[#0f2744]">
                {label === "هزینه تخمینی"
                  ? value
                    ? faNum(Number(value))
                    : "—"
                  : faNum(Number(value))}
              </p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="pb-2 font-medium">کاربر</th>
                <th className="pb-2 font-medium">نام</th>
                <th className="pb-2 font-medium">توکن</th>
                <th className="pb-2 font-medium">عکس</th>
                <th className="pb-2 font-medium">فایل</th>
                <th className="pb-2 font-medium">آخرین فعالیت</th>
              </tr>
            </thead>
            <tbody>
              {usageUsers.map((row) => (
                <tr key={row.username} className="border-t border-slate-100">
                  <td className="py-2 text-[#0f2744]">{row.username}</td>
                  <td className="py-2">{row.name}</td>
                  <td className="py-2">
                    {quotaCell(
                      row.monthTokens || 0,
                      row.tokenLimit || 0,
                      row.limitsEnabled !== false
                    )}
                  </td>
                  <td className="py-2">
                    {quotaCell(
                      row.monthImages || 0,
                      row.imageLimit || 0,
                      row.limitsEnabled !== false
                    )}
                  </td>
                  <td className="py-2">
                    {quotaCell(
                      row.monthFiles || 0,
                      row.fileLimit || 0,
                      row.limitsEnabled !== false
                    )}
                  </td>
                  <td className="py-2 text-slate-500">{formatLast(row.lastAt)}</td>
                </tr>
              ))}
              {!usageUsers.length && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-400">
                    در این بازه مصرفی ثبت نشده.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-bold text-[#0f2744]">حافظه سازمانی</h2>
        <p className="mb-3 text-sm text-slate-500">
          یادگیری سبک برای همه کاربران. مدل fine-tune نمی‌شود.
        </p>
        <form onSubmit={addOrgMemory} className="mb-3 flex flex-wrap gap-2">
          <input
            value={memDraft}
            onChange={(e) => setMemDraft(e.target.value)}
            maxLength={180}
            placeholder="مثلاً خروجی شناسنامه شغلی همیشه Word باشد"
            className="min-w-[220px] flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-2xl bg-[#0f2744] px-4 py-2 text-sm text-white"
          >
            افزودن
          </button>
        </form>
        {memNote && <p className="mb-2 text-sm text-red-600">{memNote}</p>}
        <div className="space-y-2">
          {memories.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-2"
            >
              <p className="text-sm text-[#0f2744]">
                <span className="ml-2 text-xs text-slate-400">{row.topic}</span>
                {row.content}
              </p>
              <button
                type="button"
                onClick={() => removeMemory(row.id)}
                className="shrink-0 text-sm text-red-600"
              >
                حذف
              </button>
            </div>
          ))}
          {!memories.length && (
            <p className="text-sm text-slate-400">موردی ذخیره نشده.</p>
          )}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-bold text-[#0f2744]">بانک آمار فولاد</h2>
        <p className="mb-4 text-sm leading-7 text-slate-600">
          آمار تولید و ظرفیت شرکت‌ها. رقم‌های خالی را حدس نزنید. چت اول از این فایل جواب می‌دهد.
          ظرفیت را با تولید واقعی یکی نکنید.
        </p>
        {statsDue && (
          <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            یادآوری ماهانه: بیش از ۳۰ روز از آخرین refresh گذشته است. از دکمه به‌روزرسانی استفاده کنید.
          </p>
        )}
        {statsNote && <p className="mb-3 text-sm text-slate-500">{statsNote}</p>}
        <textarea
          value={statsJson}
          onChange={(event) => setStatsJson(event.target.value)}
          dir="ltr"
          className="min-h-[320px] w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm"
          spellCheck={false}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveStats}
            disabled={statsSaving || statsRefreshing}
            className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
          >
            {statsSaving ? "در حال ذخیره..." : "ذخیره بانک آمار"}
          </button>
          <button
            type="button"
            onClick={refreshStats}
            disabled={statsSaving || statsRefreshing}
            className="rounded-2xl bg-white px-5 py-3 text-[#0f2744] shadow-sm"
          >
            {statsRefreshing ? "در حال refresh..." : "به‌روزرسانی از کدال / منابع عمومی"}
          </button>
        </div>
      </section>
    </main>
  );
}
