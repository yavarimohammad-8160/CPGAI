"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installed, setInstalled] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!deferred) {
      setHint(true);
      return;
    }
    await deferred.prompt();
    try {
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      /* کاربر منصرف شد */
    }
    setDeferred(null);
  }

  const hintText = "منوی مرورگر → نصب CPGAI";

  if (compact) {
    return (
      <div className="text-left">
        <button
          type="button"
          onClick={install}
          className="rounded-xl px-3 py-2 text-sm text-slate-500"
        >
          نصب اپ
        </button>
        {hint && !deferred ? (
          <p className="px-3 text-[11px] leading-5 text-slate-400">{hintText}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={install}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-[#0f2744]"
      >
        نصب اپ
      </button>
      {(!deferred || hint) && (
        <p className="mt-2 text-xs leading-6 text-slate-400">{hintText}</p>
      )}
    </div>
  );
}
