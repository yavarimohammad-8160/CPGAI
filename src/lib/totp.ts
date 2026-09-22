import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

const ISSUER = "CPGAI";

export function createTwoFactorSecret() {
  return generateSecret();
}

export function twoFactorKeyUri(username: string, secret: string) {
  return generateURI({
    issuer: ISSUER,
    label: username,
    secret,
    digits: 6,
    period: 30,
  });
}

export async function twoFactorQrDataUrl(otpauthUrl: string) {
  return QRCode.toDataURL(otpauthUrl, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

export async function verifyTwoFactorCode(secret: string, code: string) {
  const token = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return false;

  try {
    const result = await verify({
      secret,
      token,
      epochTolerance: 30,
    });
    return result.valid === true;
  } catch {
    return false;
  }
}
