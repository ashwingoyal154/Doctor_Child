import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance (prevents connection pool exhaustion)
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

export default prisma;
