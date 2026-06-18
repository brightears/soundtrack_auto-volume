import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db";
import { requireAdmin, hashSecret } from "../auth";

export const customerRoutes = Router();

// All customer-management is admin-only.
customerRoutes.use(requireAdmin);

// Friendly, high-entropy code with no ambiguous characters (no 0/O/1/I), e.g. "7K2M-9QXP".
function generateCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = (n: number) =>
    Array.from(crypto.randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `${pick(4)}-${pick(4)}`;
}

// List customers (never expose the hash).
customerRoutes.get("/", async (_req, res) => {
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" } });
  res.json(
    customers.map((c) => ({
      id: c.id,
      soundtrackAccountId: c.soundtrackAccountId,
      name: c.name,
      createdAt: c.createdAt,
    }))
  );
});

// Get-or-create a customer's access code. IDEMPOTENT: if a code already exists
// for this account it is NOT regenerated (that would invalidate the code already
// given to the customer) — returns { exists: true } instead. A brand-new code is
// returned ONCE on first creation. Use POST /:accountId/regenerate to intentionally
// issue a new code.
customerRoutes.post("/", async (req, res) => {
  const { soundtrackAccountId, name } = req.body ?? {};
  if (!soundtrackAccountId || typeof soundtrackAccountId !== "string") {
    return res.status(400).json({ error: "soundtrackAccountId (string) required" });
  }
  try {
    const existing = await prisma.customer.findUnique({ where: { soundtrackAccountId } });
    if (existing) {
      if (name !== undefined && name !== existing.name) {
        await prisma.customer.update({ where: { soundtrackAccountId }, data: { name } });
      }
      return res.json({ id: existing.id, soundtrackAccountId, name: name ?? existing.name, exists: true });
    }
    const code = (req.body?.code && String(req.body.code)) || generateCode();
    const customer = await prisma.customer.create({
      data: { soundtrackAccountId, name: name ?? null, accessCodeHash: hashSecret(code) },
    });
    res.json({ id: customer.id, soundtrackAccountId, name: customer.name, code });
  } catch (err) {
    res.status(500).json({ error: "Failed to save customer" });
  }
});

// Regenerate an existing customer's code. Returns the new plaintext code ONCE.
customerRoutes.post("/:accountId/regenerate", async (req, res) => {
  const code = generateCode();
  try {
    await prisma.customer.update({
      where: { soundtrackAccountId: req.params.accountId },
      data: { accessCodeHash: hashSecret(code) },
    });
    res.json({ soundtrackAccountId: req.params.accountId, code });
  } catch {
    res.status(404).json({ error: "Customer not found" });
  }
});

customerRoutes.delete("/:accountId", async (req, res) => {
  try {
    await prisma.customer.delete({ where: { soundtrackAccountId: req.params.accountId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Customer not found" });
  }
});
