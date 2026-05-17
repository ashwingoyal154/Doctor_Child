import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

function makeToken(userId: string, role: string, email: string) {
  return jwt.sign(
    { sub: userId, role, email },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
  );
}

async function main() {
  // ── Users ───────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const parent = await prisma.user.upsert({
    where: { email: "parent@test.com" },
    update: {},
    create: {
      email: "parent@test.com",
      passwordHash,
      firstName: "Sarah",
      lastName: "Jones",
      role: "PARENT",
    },
  });

  const doctor = await prisma.user.upsert({
    where: { email: "doctor@test.com" },
    update: {},
    create: {
      email: "doctor@test.com",
      passwordHash,
      firstName: "Dr. James",
      lastName: "Miller",
      role: "DOCTOR",
      doctorProfile: {
        create: {
          licenseNumber: "LIC-001",
          specialisation: "Pediatrics",
          region: "north",
          isAcceptingCases: true,
        },
      },
    },
  });

  // ── Child ────────────────────────────────────────────────────────────────────
  const existing = await prisma.child.findFirst({ where: { parentId: parent.id } });
  const child = existing ?? await prisma.child.create({
    data: {
      parentId: parent.id,
      firstName: "Liam",
      dateOfBirth: new Date("2021-03-15"),
      gender: "male",
    },
  });

  const parentToken = makeToken(parent.id, parent.role, parent.email);
  const doctorToken = makeToken(doctor.id, doctor.role, doctor.email);

  console.log("\n✅ Seed complete\n");
  console.log("PARENT_TOKEN=" + parentToken);
  console.log("DOCTOR_TOKEN=" + doctorToken);
  console.log("CHILD_ID=" + child.id);
  console.log("PARENT_ID=" + parent.id);
  console.log("DOCTOR_ID=" + doctor.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
