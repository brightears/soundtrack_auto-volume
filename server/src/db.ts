import { PrismaClient } from "@prisma/client";

/**
 * Single shared PrismaClient for the whole process.
 *
 * Previously every module called `new PrismaClient()`, opening an independent
 * connection pool each. Prisma's default pool is ~(num_cpus * 2 + 1), so five
 * clients could open ~25+ connections against the small Render Postgres and
 * exhaust `max_connections`. Import this `prisma` everywhere instead.
 *
 * To cap the pool explicitly, append `?connection_limit=5&pool_timeout=10` to
 * DATABASE_URL in the Render dashboard (Prisma reads these URL params).
 */
export const prisma = new PrismaClient();
