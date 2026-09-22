"use client";

import Image from "next/image";

type BrandMarkProps = {
  title?: string;
  subtitle?: string;
  large?: boolean;
};

export function BrandMark({
  title = "CPGAI",
  subtitle,
  large = false,
}: BrandMarkProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="cpgai-logo inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl">
        <Image
          src="/cpgai-logo.png"
          alt="CPGAI"
          width={88}
          height={88}
          className={
            large
              ? "h-10 w-10 object-contain sm:h-11 sm:w-11"
              : "h-9 w-9 object-contain sm:h-10 sm:w-10 md:h-11 md:w-11"
          }
          priority
        />
      </span>
      <div className="min-w-0">
        <h1
          className={
            large
              ? "truncate text-2xl font-bold text-[#0f2744]"
              : "truncate font-bold text-[#0f2744]"
          }
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-xs text-slate-500 sm:text-sm">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
