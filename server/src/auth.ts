import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Lightweight auth for the beta — no new dependencies (Node `crypto` only).
 *
 * Model (admin-provisioned, per the business: BMAsia sells the device + assigns
 * the account):
 *  - ONE admin password (env ADMIN_PASSWORD) gates all global/admin actions.
 *  - Each customer gets a per-account ACCESS CODE (hashed in the Customer table)
 *    that scopes them to a single Soundtrack account. The code replaces the old
 *    guessable ?account= URL.
 *  - Sessions are stateless HMAC-signed tokens in an HttpOnly cookie.
 *
 * Fail-safe: enforcement is keyed on whether ADMIN_PASSWORD is set. If it is not
 * configured, the API stays open (exactly like before this change) and logs a
 * loud warning, so a missing env var can never lock everyone out mid-beta.
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "av_session";

// Signing key for session tokens. Prefer an explicit env var so sessions survive
// restarts/deploys; otherwise fall back to an ephemeral key (users re-login after
// a deploy, which is acceptable and never breaks the app).
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");

export function isAuthConfigured(): boolean {
  return ADMIN_PASSWORD.length > 0;
}

export function logAuthStatus(): void {
  if (isAuthConfigured()) {
    console.log(
      `Auth: ENABLED (admin password set; session secret ${
        process.env.SESSION_SECRET ? "persistent" : "EPHEMERAL — set SESSION_SECRET to persist logins"
      })`
    );
  } else {
    console.warn(
      "Auth: DISABLED — ADMIN_PASSWORD is not set, so the API is OPEN to anyone. " +
        "Set ADMIN_PASSWORD (and SESSION_SECRET) in the environment to enforce auth."
    );
  }
}

// --- Secret hashing (scrypt) -------------------------------------------------

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(secret, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function compareAdminPassword(password: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Session tokens (HMAC-signed) -------------------------------------------

export interface Session {
  role: "admin" | "customer";
  accountId?: string; // present for customers
  exp: number;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

export function createSessionToken(session: Omit<Session, "exp">): string {
  const payload: Session = { ...session, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// --- Cookie helpers ----------------------------------------------------------

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getSession(req: Request): Session | null {
  return verifySessionToken(parseCookies(req)[COOKIE_NAME]);
}

// --- Express middleware ------------------------------------------------------

// Augment Express's Request with the resolved session (visible on every req).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Session;
    }
  }
}

let warnedOpen = false;

/** Attach req.auth (if any). Never blocks. */
export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const s = getSession(req);
  if (s) req.auth = s;
  next();
}

/** Require an admin session. Open (allow) when auth is not configured. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthConfigured()) {
    if (!warnedOpen) {
      console.warn("requireAdmin: auth not configured — allowing unauthenticated admin access");
      warnedOpen = true;
    }
    return next();
  }
  const s = req.auth ?? getSession(req);
  if (s?.role === "admin") {
    req.auth = s;
    return next();
  }
  res.status(401).json({ error: "Admin authentication required" });
}

/** Require any valid session (admin or customer). Open when auth not configured. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthConfigured()) return next();
  const s = req.auth ?? getSession(req);
  if (s) {
    req.auth = s;
    return next();
  }
  res.status(401).json({ error: "Authentication required" });
}

/**
 * Resolve the account a customer is allowed to act on. Returns:
 *  - admin: null (no restriction — may act on any account)
 *  - customer: their accountId
 *  - unauthenticated + auth disabled: null (legacy open behavior)
 * Use the returned value to scope queries / enforce ownership.
 */
export function scopedAccountId(req: Request): string | null {
  if (!isAuthConfigured()) return null;
  const s = req.auth ?? getSession(req);
  if (s?.role === "customer") return s.accountId ?? "__none__";
  return null; // admin
}

/** True if the request is allowed to act on the given account. */
export function canAccessAccount(req: Request, accountId: string | null | undefined): boolean {
  const scope = scopedAccountId(req);
  if (scope === null) return true; // admin or auth disabled
  return !!accountId && scope === accountId;
}
