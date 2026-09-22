import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import {
  createTwoFactorSecret,
  twoFactorKeyUri,
  twoFactorQrDataUrl,
  verifyTwoFactorCode,
} from "@/lib/totp";

export type UserRole = "admin" | "user";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  active: boolean;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  monthly_token_limit: number;
  monthly_image_limit: number;
  monthly_file_limit: number;
  limits_enabled: boolean;
};

export const DEFAULT_MONTHLY_LIMITS = {
  monthly_token_limit: 300000,
  monthly_image_limit: 30,
  monthly_file_limit: 40,
};

export const ADMIN_MONTHLY_LIMITS = {
  monthly_token_limit: 3000000,
  monthly_image_limit: 300,
  monthly_file_limit: 400,
};

export function parseLimit(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function resolveUserLimits(user?: User | null) {
  if (user?.role === "admin") {
    if (user.limits_enabled !== true) {
      return { enabled: false, tokens: 0, images: 0, files: 0 };
    }
    return {
      enabled: true,
      tokens: parseLimit(user.monthly_token_limit, ADMIN_MONTHLY_LIMITS.monthly_token_limit),
      images: parseLimit(user.monthly_image_limit, ADMIN_MONTHLY_LIMITS.monthly_image_limit),
      files: parseLimit(user.monthly_file_limit, ADMIN_MONTHLY_LIMITS.monthly_file_limit),
    };
  }
  const enabled = user ? user.limits_enabled !== false : true;
  return {
    enabled,
    tokens: parseLimit(
      user?.monthly_token_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_token_limit
    ),
    images: parseLimit(
      user?.monthly_image_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_image_limit
    ),
    files: parseLimit(
      user?.monthly_file_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_file_limit
    ),
  };
}

export type PublicUser = Omit<
  User,
  "passwordHash" | "twoFactorSecret" | "twoFactorEnabled"
>;

const USERS_PATH = path.join(process.cwd(), "data", "users.json");
const SALT_ROUNDS = 10;

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
    monthly_token_limit: user.monthly_token_limit,
    monthly_image_limit: user.monthly_image_limit,
    monthly_file_limit: user.monthly_file_limit,
    limits_enabled: user.limits_enabled,
  };
}

async function writeUsers(users: User[]) {
  await mkdir(path.dirname(USERS_PATH), { recursive: true });
  await writeFile(USERS_PATH, JSON.stringify(users, null, 2), "utf8");
}

async function seedAdmin(): Promise<User[]> {
  const users: User[] = [
    {
      id: randomUUID(),
      username: "admin",
      passwordHash: await bcrypt.hash("Cpgai@123", SALT_ROUNDS),
      name: "مدیر سامانه",
      role: "admin",
      active: true,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      monthly_token_limit: ADMIN_MONTHLY_LIMITS.monthly_token_limit,
      monthly_image_limit: ADMIN_MONTHLY_LIMITS.monthly_image_limit,
      monthly_file_limit: ADMIN_MONTHLY_LIMITS.monthly_file_limit,
      limits_enabled: false,
    },
  ];
  await writeUsers(users);
  return users;
}

function normalizeUser(item: Partial<User> & Pick<User, "id" | "username" | "passwordHash" | "name" | "role" | "active">): User {
  const admin = item.role === "admin";
  const defaults = admin ? ADMIN_MONTHLY_LIMITS : DEFAULT_MONTHLY_LIMITS;
  return {
    id: item.id,
    username: item.username,
    passwordHash: item.passwordHash,
    name: item.name,
    role: item.role,
    active: item.active,
    twoFactorEnabled: !!item.twoFactorEnabled,
    twoFactorSecret: item.twoFactorSecret || null,
    monthly_token_limit: parseLimit(item.monthly_token_limit, defaults.monthly_token_limit),
    monthly_image_limit: parseLimit(item.monthly_image_limit, defaults.monthly_image_limit),
    monthly_file_limit: parseLimit(item.monthly_file_limit, defaults.monthly_file_limit),
    limits_enabled: admin
      ? item.limits_enabled === true
      : item.limits_enabled !== false,
  };
}

export async function readUsers(): Promise<User[]> {
  try {
    const raw = await readFile(USERS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((item: User) => normalizeUser(item));
    }
    return seedAdmin();
  } catch {
    return seedAdmin();
  }
}

export async function saveUsers(users: User[]) {
  await writeUsers(users);
}

export function publicUsers(users: User[]) {
  return users.map(toPublic);
}

export function canonUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function findUser(users: User[], username: string) {
  const name = canonUsername(username);
  if (!name) return undefined;
  return users.find((user) => canonUsername(user.username) === name);
}

export function findUserById(users: User[], id: string) {
  return users.find((user) => user.id === id);
}

export function activeAdminCount(users: User[]) {
  return users.filter((user) => user.role === "admin" && user.active).length;
}

export function isOnlyAdmin(users: User[], user: User) {
  return (
    user.role === "admin" &&
    users.filter((item) => item.role === "admin").length <= 1
  );
}

export function isLastActiveAdmin(users: User[], user: User) {
  return user.role === "admin" && user.active && activeAdminCount(users) <= 1;
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function isTwoFactorOn(user: User) {
  return (
    user.role === "admin" && !!user.twoFactorEnabled && !!user.twoFactorSecret
  );
}

export async function authenticate(
  username: string,
  password: string,
  code?: string
) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user) return { error: "نام کاربری یا رمز عبور اشتباه است." as const };
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "نام کاربری یا رمز عبور اشتباه است." as const };
  if (!user.active) return { error: "حساب کاربری غیرفعال است." as const };

  if (isTwoFactorOn(user)) {
    const token = String(code || "").trim();
    if (!token) return { needs2FA: true as const };
    const valid = await verifyTwoFactorCode(user.twoFactorSecret as string, token);
    if (!valid) {
      return { error: "کد تأیید دو مرحله‌ای اشتباه است." as const };
    }
  }

  return { user: toPublic(user) };
}

export async function createUser(input: {
  username: string;
  password: string;
  name: string;
  role: UserRole;
}) {
  const username = canonUsername(input.username);
  const name = input.name.trim();
  const password = input.password;
  const role: UserRole = input.role === "admin" ? "admin" : "user";

  if (!username || !name || !password) {
    return { error: "نام، یوزرنیم و رمز الزامی است." as const };
  }

  const users = await readUsers();
  if (users.some((user) => canonUsername(user.username) === username)) {
    return { error: "این یوزرنیم قبلاً ثبت شده است." as const };
  }

  const user: User = {
    id: randomUUID(),
    username,
    passwordHash: await hashPassword(password),
    name,
    role,
    active: true,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    monthly_token_limit: role === "admin"
      ? ADMIN_MONTHLY_LIMITS.monthly_token_limit
      : DEFAULT_MONTHLY_LIMITS.monthly_token_limit,
    monthly_image_limit: role === "admin"
      ? ADMIN_MONTHLY_LIMITS.monthly_image_limit
      : DEFAULT_MONTHLY_LIMITS.monthly_image_limit,
    monthly_file_limit: role === "admin"
      ? ADMIN_MONTHLY_LIMITS.monthly_file_limit
      : DEFAULT_MONTHLY_LIMITS.monthly_file_limit,
    limits_enabled: role !== "admin",
  };

  users.push(user);
  await saveUsers(users);
  return { user: toPublic(user) };
}

export async function setUserActive(id: string, active: boolean) {
  const users = await readUsers();
  const user = findUserById(users, id);
  if (!user) return { error: "کاربر پیدا نشد." as const };

  if (!active && isLastActiveAdmin(users, user)) {
    return { error: "نمی‌توان آخرین ادمین را غیرفعال کرد." as const };
  }

  user.active = active;
  await saveUsers(users);
  return { user: toPublic(user) };
}

export async function setUserLimits(
  id: string,
  input: {
    monthly_token_limit?: unknown;
    monthly_image_limit?: unknown;
    monthly_file_limit?: unknown;
    limits_enabled?: unknown;
  }
) {
  const users = await readUsers();
  const user = findUserById(users, id);
  if (!user) return { error: "کاربر پیدا نشد." as const };

  if (user.role === "admin") {
    const enabled =
      input.limits_enabled === true ||
      input.limits_enabled === 1 ||
      input.limits_enabled === "1";
    user.limits_enabled = enabled;
    if (enabled) {
      user.monthly_token_limit = parseLimit(
        input.monthly_token_limit,
        ADMIN_MONTHLY_LIMITS.monthly_token_limit
      );
      user.monthly_image_limit = parseLimit(
        input.monthly_image_limit,
        ADMIN_MONTHLY_LIMITS.monthly_image_limit
      );
      user.monthly_file_limit = parseLimit(
        input.monthly_file_limit,
        ADMIN_MONTHLY_LIMITS.monthly_file_limit
      );
    }
  } else {
    user.limits_enabled = input.limits_enabled === false || input.limits_enabled === 0 || input.limits_enabled === "0"
      ? false
      : true;
    user.monthly_token_limit = parseLimit(
      input.monthly_token_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_token_limit
    );
    user.monthly_image_limit = parseLimit(
      input.monthly_image_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_image_limit
    );
    user.monthly_file_limit = parseLimit(
      input.monthly_file_limit,
      DEFAULT_MONTHLY_LIMITS.monthly_file_limit
    );
  }

  await saveUsers(users);
  return { user: toPublic(user) };
}

export async function changeOwnPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user) return { error: "کاربر پیدا نشد." as const };
  const current = String(currentPassword || "");
  const next = String(newPassword || "");
  const confirm = String(confirmPassword || "");
  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "رمز فعلی اشتباه است." as const };
  }
  if (next.length < 8) {
    return { error: "رمز جدید باید حداقل ۸ کاراکتر باشد." as const };
  }
  if (next !== confirm) {
    return { error: "رمز جدید و تکرار آن یکی نیست." as const };
  }
  user.passwordHash = await hashPassword(next);
  await saveUsers(users);
  return { ok: true as const };
}

export async function setUserPassword(id: string, password: string) {
  const users = await readUsers();
  const user = findUserById(users, id);
  if (!user) return { error: "کاربر پیدا نشد." as const };
  if (!password.trim()) return { error: "رمز جدید الزامی است." as const };

  user.passwordHash = await hashPassword(password);
  await saveUsers(users);
  return { user: toPublic(user) };
}

export async function deleteUser(id: string) {
  const users = await readUsers();
  const user = findUserById(users, id);
  if (!user) return { error: "کاربر پیدا نشد." as const };

  if (isOnlyAdmin(users, user)) {
    return { error: "نمی‌توان آخرین ادمین را حذف کرد." as const };
  }

  const next = users.filter((item) => item.id !== id);
  await saveUsers(next);
  return { ok: true as const };
}

export async function twoFactorStatus(username: string) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user || user.role !== "admin" || !user.active) {
    return { error: "دسترسی غیرمجاز است." as const };
  }
  return { enabled: isTwoFactorOn(user) };
}

export async function beginTwoFactorSetup(username: string) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user || user.role !== "admin" || !user.active) {
    return { error: "دسترسی غیرمجاز است." as const };
  }
  if (isTwoFactorOn(user)) {
    return {
      error: "تأیید دو مرحله‌ای قبلاً فعال است. ابتدا آن را غیرفعال کنید." as const,
    };
  }

  const secret = createTwoFactorSecret();
  user.twoFactorSecret = secret;
  user.twoFactorEnabled = false;
  await saveUsers(users);

  const otpauthUrl = twoFactorKeyUri(user.username, secret);
  const qrDataUrl = await twoFactorQrDataUrl(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
}

export async function confirmTwoFactor(username: string, code: string) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user || user.role !== "admin" || !user.active) {
    return { error: "دسترسی غیرمجاز است." as const };
  }
  if (isTwoFactorOn(user)) {
    return { error: "تأیید دو مرحله‌ای قبلاً فعال است." as const };
  }
  if (!user.twoFactorSecret) {
    return { error: "ابتدا فعال‌سازی را شروع کنید." as const };
  }
  const valid = await verifyTwoFactorCode(user.twoFactorSecret, code);
  if (!valid) {
    return { error: "کد تأیید دو مرحله‌ای اشتباه است." as const };
  }

  user.twoFactorEnabled = true;
  await saveUsers(users);
  return { ok: true as const };
}

export async function disableTwoFactor(username: string, code: string) {
  const users = await readUsers();
  const user = findUser(users, username);
  if (!user || user.role !== "admin" || !user.active) {
    return { error: "دسترسی غیرمجاز است." as const };
  }
  if (!isTwoFactorOn(user)) {
    return { error: "تأیید دو مرحله‌ای فعال نیست." as const };
  }
  const valid = await verifyTwoFactorCode(user.twoFactorSecret as string, code);
  if (!valid) {
    return { error: "کد تأیید دو مرحله‌ای اشتباه است." as const };
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  await saveUsers(users);
  return { ok: true as const };
}
