import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import prisma from "../config/prisma";

const router = Router();

function signToken(userId: string, role: Role, email: string) {
  return jwt.sign(
    { sub: userId, role, email },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

const RegisterSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("PARENT"),
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
  }),
  z.object({
    role: z.literal("DOCTOR"),
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    licenseNumber: z.string().min(1),
    specialisation: z.string().optional(),
    region: z.string().min(1),
  }),
]);

/**
 * POST /api/auth/register
 *
 * Creates a PARENT or DOCTOR account. DOCTOR registration additionally
 * creates a DoctorProfile with licenseNumber, specialisation, and region.
 */
router.post("/register", async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role as Role,
      ...(data.role === "DOCTOR" && {
        doctorProfile: {
          create: {
            licenseNumber: data.licenseNumber,
            specialisation: data.specialisation,
            region: data.region,
          },
        },
      }),
    },
  });

  const token = signToken(user.id, user.role, user.email);
  res.status(201).json({ success: true, token });
});

// ─── Login ────────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 *
 * Validates credentials and returns a signed JWT.
 */
router.post("/login", async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken(user.id, user.role, user.email);
  res.json({ success: true, token });
});

export default router;
