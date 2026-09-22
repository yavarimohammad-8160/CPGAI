"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";

function getStoredUser() {
  return localStorage.getItem("cpgai-user") || "";
}

function getStoredRole() {
  return localStorage.getItem("cpgai-role") || "";
}

function getStoredTheme(): "light" | "dark" {
  return localStorage.getItem("cpgai-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  localStorage.setItem("cpgai-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function formatSecret(secret: string) {
  return secret.replace(/.{4}/g, "$& ").trim();
}

export default function SettingsPage() {
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
  const storedTheme = useSyncExternalStore(
    () => () => {},
    getStoredTheme,
    (): "light" | "dark" => "light"
  );
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorReady, setTwoFactorReady] = useState(false);
  const [setupQr, setSetupQr] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [otp, setOtp] = useState("");
  const [disableMode, setDisableMode] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [quotaLine, setQuotaLine] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);

  if (storedTheme && theme !== storedTheme) {
    setTheme(storedTheme);
  }

  useEffect(() => {
    if (!username) router.replace("/");
  }, [username, router]);

  useEffect(() => {
    setVoiceOn(localStorage.getItem("cpgai-voice") === "on");
  }, []);

  useEffect(() => {
    if (!username) return;
    async function loadQuota() {
      try {
        const res = await fetch("/api/quota", {
          headers: { "x-cpgai-user": username },
        });
        const data = await res.json();
        if (res.ok && typeof data.line === "string") setQuotaLine(data.line);
      } catch {
        /* optional */
      }
    }
    void loadQuota();
  }, [username]);

  useEffect(() => {
    if (role !== "admin" || !username) return;

    async function loadStatus() {
      try {
        const res = await fetch("/api/2fa", {
          headers: {
            "x-cpgai-role": "admin",
            "x-cpgai-user": username,
          },
        });
        const data = await res.json();
        if (!res.ok) {
          setTwoFactorError(data.error || "خواندن وضعیت تأیید دو مرحله‌ای ممکن نشد.");
          return;
        }
        setTwoFactorEnabled(!!data.enabled);
      } catch {
        setTwoFactorError("ارتباط با سرور برقرار نشد.");
      } finally {
        setTwoFactorReady(true);
      }
    }

    void loadStatus();
  }, [role, username]);

  function twoFactorHeaders() {
    return {
      "Content-Type": "application/json",
      "x-cpgai-role": localStorage.getItem("cpgai-role") || "",
      "x-cpgai-user": localStorage.getItem("cpgai-user") || "",
    };
  }

  async function startTwoFactorSetup() {
    setTwoFactorError("");
    setTwoFactorBusy(true);
    setDisableMode(false);
    try {
      const res = await fetch("/api/2fa", {
        method: "POST",
        headers: twoFactorHeaders(),
        body: JSON.stringify({ action: "setup" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTwoFactorError(data.error || "شروع فعال‌سازی ممکن نشد.");
        return;
      }
      setSetupQr(data.qrDataUrl || "");
      setSetupSecret(data.secret || "");
      setOtp("");
    } catch {
      setTwoFactorError("ارتباط با سرور برقرار نشد.");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function confirmTwoFactor() {
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setTwoFactorError("کد ۶ رقمی را وارد کنید.");
      return;
    }
    setTwoFactorError("");
    setTwoFactorBusy(true);
    try {
      const res = await fetch("/api/2fa", {
        method: "POST",
        headers: twoFactorHeaders(),
        body: JSON.stringify({ action: "enable", code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTwoFactorError(data.error || "کد تأیید دو مرحله‌ای اشتباه است.");
        return;
      }
      setTwoFactorEnabled(true);
      setSetupQr("");
      setSetupSecret("");
      setOtp("");
    } catch {
      setTwoFactorError("ارتباط با سرور برقرار نشد.");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function confirmDisableTwoFactor() {
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setTwoFactorError("کد فعلی Authenticator را وارد کنید.");
      return;
    }
    setTwoFactorError("");
    setTwoFactorBusy(true);
    try {
      const res = await fetch("/api/2fa", {
        method: "POST",
        headers: twoFactorHeaders(),
        body: JSON.stringify({ action: "disable", code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTwoFactorError(data.error || "کد تأیید دو مرحله‌ای اشتباه است.");
        return;
      }
      setTwoFactorEnabled(false);
      setDisableMode(false);
      setOtp("");
    } catch {
      setTwoFactorError("ارتباط با سرور برقرار نشد.");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  function cancelTwoFactorForm() {
    setSetupQr("");
    setSetupSecret("");
    setDisableMode(false);
    setOtp("");
    setTwoFactorError("");
  }

  function chooseTheme(next: "light" | "dark") {
    applyTheme(next);
    setTheme(next);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordNote("");
    setPasswordError("");
    setPasswordBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cpgai-user": username,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || "تغییر رمز انجام نشد.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNote(data.text || "رمز تغییر کرد.");
    } catch {
      setPasswordError("ارتباط با سرور برقرار نشد.");
    } finally {
      setPasswordBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem("cpgai-user");
    localStorage.removeItem("cpgai-role");
    localStorage.removeItem("cpgai-name");
    router.replace("/");
  }

  if (!username) return null;

  return (
    <main className="cpg-bg mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between rounded-3xl bg-white px-5 py-4 shadow-sm">
        <BrandMark subtitle="تنظیمات" />
        <Link href="/chat" className="rounded-xl px-3 py-2 text-sm text-slate-500">
          چت
        </Link>
      </header>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0f2744]">پروفایل</h2>
        <p className="text-slate-600">نام کاربری: {username}</p>
        <p className="mt-2 text-slate-600">
          نقش: {role === "admin" ? "ادمین" : "کاربر"}
        </p>
        {quotaLine ? (
          <p className="mt-2 text-sm text-slate-500">{quotaLine}</p>
        ) : null}

        <form onSubmit={changePassword} className="mt-6 grid gap-3">
          <h3 className="font-medium text-[#0f2744]">تغییر رمز</h3>
          <div>
            <label className="block text-sm text-slate-600">رمز فعلی</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600">رمز جدید</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600">تکرار رمز جدید</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </div>
          {passwordError && (
            <p className="text-sm text-red-600">{passwordError}</p>
          )}
          {passwordNote && (
            <p className="text-sm text-emerald-700">{passwordNote}</p>
          )}
          <button
            type="submit"
            disabled={passwordBusy}
            className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
          >
            {passwordBusy ? "در حال ذخیره..." : "تغییر رمز"}
          </button>
        </form>
      </section>

      {role === "admin" && (
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="mb-2 font-bold text-[#0f2744]">تأیید دو مرحله‌ای</h2>
          <p className="mb-4 text-sm leading-7 text-slate-600">
            با اپ Authenticator مثل Google Authenticator یک لایه امنیتی بیشتر برای ورود ادمین اضافه می‌شود.
          </p>
          <p className="mb-4 text-slate-600">
            وضعیت: {twoFactorReady ? (twoFactorEnabled ? "فعال" : "غیرفعال") : "در حال بررسی..."}
          </p>

          {twoFactorError && (
            <p className="mb-4 text-sm text-red-600">{twoFactorError}</p>
          )}

          {setupQr ? (
            <div className="space-y-4">
              <p className="text-sm leading-7 text-slate-600">
                اپ Authenticator را باز کنید و این QR را اسکن کنید. اگر اسکن ممکن نبود، کلید را دستی وارد کنید.
              </p>
              <div className="flex justify-center rounded-2xl bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setupQr} alt="کد QR تأیید دو مرحله‌ای" className="h-52 w-52" />
              </div>
              {setupSecret && (
                <p dir="ltr" className="rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm tracking-widest text-[#0f2744]">
                  {formatSecret(setupSecret)}
                </p>
              )}
              <label className="block text-sm text-slate-600">کد ۶ رقمی</label>
              <input
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xl tracking-[0.4em]"
                placeholder="000000"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmTwoFactor}
                  disabled={twoFactorBusy}
                  className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
                >
                  {twoFactorBusy ? "در حال تأیید..." : "تأیید و فعال‌سازی"}
                </button>
                <button
                  type="button"
                  onClick={cancelTwoFactorForm}
                  className="rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"
                >
                  انصراف
                </button>
              </div>
            </div>
          ) : disableMode ? (
            <div className="space-y-4">
              <p className="text-sm leading-7 text-slate-600">
                برای غیرفعال‌سازی، کد فعلی اپ Authenticator را وارد کنید.
              </p>
              <label className="block text-sm text-slate-600">کد فعلی</label>
              <input
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xl tracking-[0.4em]"
                placeholder="000000"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmDisableTwoFactor}
                  disabled={twoFactorBusy}
                  className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
                >
                  {twoFactorBusy ? "در حال بررسی..." : "غیرفعال‌سازی"}
                </button>
                <button
                  type="button"
                  onClick={cancelTwoFactorForm}
                  className="rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"
                >
                  انصراف
                </button>
              </div>
            </div>
          ) : twoFactorEnabled ? (
            <button
              type="button"
              onClick={() => {
                setTwoFactorError("");
                setOtp("");
                setDisableMode(true);
              }}
              className="rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"
            >
              غیرفعال‌سازی تأیید دو مرحله‌ای
            </button>
          ) : (
            <button
              type="button"
              onClick={startTwoFactorSetup}
              disabled={twoFactorBusy || !twoFactorReady}
              className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
            >
              {twoFactorBusy ? "در حال آماده‌سازی..." : "فعال‌سازی تأیید دو مرحله‌ای"}
            </button>
          )}
        </section>
      )}

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-bold text-[#0f2744]">صدا</h2>
        <p className="mb-4 text-sm text-slate-500">
          پخش صدا زیر پیام‌ها به‌صورت پیش‌فرض خاموش است.
        </p>
        <button
          type="button"
          onClick={() => {
            const next = localStorage.getItem("cpgai-voice") === "on" ? "off" : "on";
            localStorage.setItem("cpgai-voice", next);
            setVoiceOn(next === "on");
          }}
          className={
            voiceOn
              ? "rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
              : "rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"
          }
        >
          {voiceOn ? "پخش صدا روشن است" : "پخش صدا خاموش است"}
        </button>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0f2744]">تم</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => chooseTheme("light")}
            className={theme === "light" ? "rounded-2xl bg-[#0f2744] px-5 py-3 text-white" : "rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"}
          >
            روشن
          </button>
          <button
            type="button"
            onClick={() => chooseTheme("dark")}
            className={theme === "dark" ? "rounded-2xl bg-[#0f2744] px-5 py-3 text-white" : "rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]"}
          >
            تیره
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {role === "admin" && (
            <Link href="/admin" className="rounded-2xl bg-slate-50 px-5 py-3 text-[#0f2744]">
              کاربران
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="rounded-2xl bg-[#0f2744] px-5 py-3 text-white"
          >
            خروج
          </button>
        </div>
      </section>
    </main>
  );
}
