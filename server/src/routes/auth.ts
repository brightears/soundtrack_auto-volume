import { Router } from "express";
import { prisma } from "../db";
import {
  compareAdminPassword,
  verifySecret,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  isAuthConfigured,
} from "../auth";

export const authRoutes = Router();

/**
 * Single-field login. The same box accepts the admin password OR a customer
 * access code; we try admin first, then match the code against stored customer
 * access-code hashes. (O(customers) scrypt checks — fine at beta scale; if this
 * ever grows large, switch to a username or a lookup key.)
 */
authRoutes.post("/login", async (req, res) => {
  const code = (req.body?.password ?? req.body?.code ?? "").toString().trim();
  if (!code) return res.status(400).json({ error: "Access code required" });

  if (compareAdminPassword(code)) {
    setSessionCookie(res, createSessionToken({ role: "admin" }));
    return res.json({ role: "admin" });
  }

  const customers = await prisma.customer.findMany();
  for (const c of customers) {
    if (verifySecret(code, c.accessCodeHash)) {
      setSessionCookie(res, createSessionToken({ role: "customer", accountId: c.soundtrackAccountId }));
      return res.json({ role: "customer", accountId: c.soundtrackAccountId, name: c.name });
    }
  }

  return res.status(401).json({ error: "Invalid access code" });
});

authRoutes.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// The frontend calls this on load to decide whether to show the login screen and
// in which mode (admin vs the customer's scoped dashboard).
authRoutes.get("/me", (req, res) => {
  const s = getSession(req);
  res.json({
    authConfigured: isAuthConfigured(),
    authenticated: !!s,
    role: s?.role ?? null,
    accountId: s?.accountId ?? null,
  });
});
