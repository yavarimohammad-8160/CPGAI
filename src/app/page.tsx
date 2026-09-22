"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { InstallAppButton } from "@/components/install-app";

export default function LoginPage() {
  const router = useRouter();
  const otpRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("cpgai-user")) {
      router.replace("/chat");
    }
  }, [router]);

  useEffect(() => {
    if (needs2FA) otpRef.current?.focus();
  }, [needs2FA]);

  function finishLogin(data: { username: string; role: string; name?: string }) {
    const name = String(data.name || "").trim();
    localStorage.setItem("cpgai-user", data.username);
    localStorage.setItem("cpgai-role", data.role);
    localStorage.setItem("cpgai-name", name || data.username);
    router.push("/chat");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "نام کاربری یا رمز عبور اشتباه است.");
        return;
      }

      if (data.needs2FA) {
        setNeeds2FA(true);
        setOtp("");
        return;
      }

      finishLogin(data);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify2FA(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("کد ۶ رقمی را وارد کنید.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "کد تأیید دو مرحله‌ای اشتباه است.");
        return;
      }

      if (data.needs2FA) {
        setError("کد تأیید دو مرحله‌ای را وارد کنید.");
        return;
      }

      finishLogin(data);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setNeeds2FA(false);
    setOtp("");
    setError("");
  }

  return (
    <main className="cpg-bg flex min-h-screen items-center justify-center p-4">
      {needs2FA ? (
        <form
          onSubmit={handleVerify2FA}
          className="w-full max-w-md rounded-3xl bg-white p-8 shadow-lg"
        >
          <div className="mb-8">
            <BrandMark large subtitle="تأیید دو مرحله‌ای" />
          </div>

          <p className="mb-6 text-sm leading-7 text-slate-600">
            کد ۶ رقمی را از اپ Authenticator وارد کنید.
          </p>

          <label className="block text-sm text-slate-600">کد تأیید</label>
          <input
            ref={otpRef}
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            dir="ltr"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-2xl tracking-[0.4em]"
            placeholder="000000"
          />

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-[#0f2744] px-4 py-3 text-white"
          >
            {loading ? "در حال بررسی..." : "تأیید کد"}
          </button>
          <button
            type="button"
            onClick={backToPassword}
            className="mt-3 w-full rounded-2xl px-4 py-3 text-sm text-slate-500"
          >
            بازگشت
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-3xl bg-white p-8 shadow-lg"
        >
          <div className="mb-8">
            <BrandMark large subtitle="دستیار هوشمند سی‌پی‌جی پارس" />
          </div>

          <label className="block text-sm text-slate-600">نام کاربری</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />

          <label className="mt-4 block text-sm text-slate-600">رمز عبور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-[#0f2744] px-4 py-3 text-white"
          >
            {loading ? "در حال ورود..." : "ورود به سامانه"}
          </button>
          <InstallAppButton />
        </form>
      )}
    </main>
  );
}
