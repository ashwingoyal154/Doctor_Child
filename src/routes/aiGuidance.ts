import { Router, Request, Response } from "express";
import { z } from "zod";
import { HealthCondition } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { requireRole, requireChildAccess } from "../middleware/rbac";
import { generateAiGuidance } from "../services/aiGuidanceService";
import prisma from "../config/prisma";

const router = Router();

const AiGuidanceSchema = z.object({
  childId: z.string().cuid(),
  consultationId: z.string().cuid().optional(),
  latestMetrics: z.object({
    ageMonths: z.number().int().min(0).max(240),
    heightCm: z.number().positive().max(250),
    weightKg: z.number().positive().max(200),
    gender: z.enum(["male", "female"]),
  }),
  healthConditions: z
    .array(z.nativeEnum(HealthCondition))
    .default([]),
  parentConcerns: z.string().max(2000).optional(),
});

/**
 * POST /api/ai-guidance/generate
 *
 * Accepts a child's profile and returns proprietary nutrition/supplement
 * recommendations from the AI model.
 *
 * If the model flags escalation criteria, escalationAdvised = true is
 * returned in the response body — the client should then call
 * POST /api/consultations/escalate.
 *
 * Only PARENT and ADMIN may call this endpoint (doctors access records
 * directly via consultation endpoints).
 */
router.post(
  "/generate",
  authenticate,
  requireRole("PARENT", "ADMIN"),
  requireChildAccess("childId"),
  async (req: Request, res: Response) => {
    const parsed = AiGuidanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;

    // Ensure consultation record exists (create one if not provided)
    let consultationId = input.consultationId;
    if (!consultationId) {
      const child = await prisma.child.findUnique({ where: { id: input.childId } });
      if (!child) {
        res.status(404).json({ error: "Child not found" });
        return;
      }

      const consultation = await prisma.consultation.create({
        data: {
          childId: input.childId,
          parentId: child.parentId,
          status: "AI_MANAGED",
        },
      });
      consultationId = consultation.id;
    }

    const guidance = await generateAiGuidance({ ...input, consultationId });

    // Cache the guidance snapshot on the consultation for doctor context
    await prisma.consultation.update({
      where: { id: consultationId },
      data: { lastAiGuidanceSnapshot: guidance as object },
    });

    res.json({ success: true, data: guidance });
  }
);

export default router;
