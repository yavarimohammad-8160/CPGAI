import { NextRequest, NextResponse } from "next/server";
import { getQuota } from "@/lib/usage";
import { canonUsername } from "@/lib/users";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const username = canonUsername(req.headers.get("x-cpgai-user") || "");
  if (!username) {
    return NextResponse.json({ error: "کاربر مشخص نیست." }, { status: 400 });
  }
  try {
    const quota = await getQuota(username);
    const images = quota.used.images;
    const imageLimit = quota.limits.images;
    return NextResponse.json({
      used: quota.used,
      limits: quota.limits,
      line: quota.limits.enabled
        ? "مصرف این ماه: " + images + " / " + imageLimit + " تصویر"
        : "",
    });
  } catch (err) {
    console.log("QUOTA_GET_ERROR", err);
    return NextResponse.json({ error: "خواندن سقف مصرف ممکن نشد." }, { status: 500 });
  }
}
