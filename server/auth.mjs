// Доступ хранителя: scrypt-хэш пароля, сессии в памяти, cookie + CSRF, ограничение перебора.
import "./env.mjs";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.RODMUR_DATA_DIR || "data";
const ADMIN_FILE = join(DATA_DIR, "admin.json");
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const WINDOW = 15 * 60 * 1000;

const sessions = new Map();
const attempts = new Map();

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function readCredentials() {
  if (existsSync(ADMIN_FILE)) return JSON.parse(readFileSync(ADMIN_FILE, "utf8"));
  return null;
}

function writeCredentials(password) {
  mkdirSync(DATA_DIR, { recursive: true });
  const salt = randomBytes(16).toString("hex");
  const record = { salt, hash: hashPassword(password, salt), createdAt: new Date().toISOString() };
  writeFileSync(ADMIN_FILE, JSON.stringify(record, null, 1), { mode: 0o600 });
  return record;
}

/** Пароль берётся из окружения; иначе он генерируется один раз и печатается в журнал запуска. */
export function initAuth(log = console.log) {
  const fromEnv = process.env.RODMUR_ADMIN_PASSWORD;
  const stored = readCredentials();
  if (fromEnv) {
    if (!stored || stored.hash !== hashPassword(fromEnv, stored.salt)) writeCredentials(fromEnv);
    log("  Хранитель: пароль задан переменной RODMUR_ADMIN_PASSWORD");
    return;
  }
  if (stored) {
    log("  Хранитель: пароль из data/admin.json");
    return;
  }
  const generated = randomBytes(9).toString("base64url");
  writeCredentials(generated);
  log(`  Хранитель: создан пароль ${generated}`);
  log("  Он сохранён в data/admin.json в виде хэша. Смените его в панели хранителя.");
}

export function passwordMatches(password) {
  const record = readCredentials();
  if (!record || typeof password !== "string" || password.length > 200) return false;
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hashPassword(password, record.salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function changePassword(current, next) {
  if (!passwordMatches(current)) throw new Error("Текущий пароль неверен");
  if (typeof next !== "string" || next.length < 8) throw new Error("Новый пароль: не меньше 8 символов");
  writeCredentials(next);
  for (const [token, session] of sessions) if (!session.keep) sessions.delete(token);
}

export function loginAllowed(ip) {
  const record = attempts.get(ip);
  if (!record) return { ok: true };
  if (Date.now() - record.first > WINDOW) {
    attempts.delete(ip);
    return { ok: true };
  }
  if (record.count >= MAX_ATTEMPTS) {
    return { ok: false, retryIn: Math.ceil((WINDOW - (Date.now() - record.first)) / 1000) };
  }
  return { ok: true };
}

export function noteFailure(ip) {
  const record = attempts.get(ip) || { first: Date.now(), count: 0 };
  record.count++;
  attempts.set(ip, record);
}

export function clearFailures(ip) {
  attempts.delete(ip);
}

export function createSession() {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  sessions.set(token, { csrf, expires: Date.now() + SESSION_TTL });
  return { token, csrf };
}

export function destroySession(token) {
  sessions.delete(token);
}

export function sessionOf(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expires = Date.now() + SESSION_TTL;
  return session;
}

export function csrfOk(session, header) {
  if (!session || typeof header !== "string") return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map(part => {
      const i = part.indexOf("=");
      return i < 0 ? [] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
    }).filter(pair => pair.length === 2)
  );
}

export function sessionCookie(token, secure) {
  const parts = [`rodmur_sid=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${SESSION_TTL / 1000}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export const fingerprint = token => createHash("sha256").update(token).digest("hex").slice(0, 8);
