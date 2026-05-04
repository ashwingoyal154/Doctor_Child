import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { requireChildAccess } from "../middleware/rbac";
import { calculatePercentiles } from "../services/percentileService";
import prisma from "../config/prisma";

const router = Router();

const CalculatePercentileSchema = z.object({
  ageMonths: z.number().int().min(0).max(240),
  heightCm: z.number().positive().max(250),
  weightKg: z.number().positive().max(200),
  gender: z.enum(["male", "female"]),
  childId: z.string().cuid().optional(),
});

/**
 * POST /api/metrics/calculate-percentile
 *
 * Accepts age/height/weight, returns WHO/CDC percentile data.
 * If childId is provided (and the caller has access), the result is
 * persisted as a GrowthMetric record.
 */
router.post(
  "/calculate-percentile",
  authenticate,
  async (req: Request, res: Response) => {
    const parsed = CalculatePercentileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { ageMonths, heightCm, weightKg, gender, childId } = parsed.data;
    const result = calculatePercentiles(ageMonths, heightCm, weightKg, gender);

    // Persist if a childId was provided and the caller owns that child
    if (childId) {
      // Verify parent owns the child (or caller is DOCTOR/ADMIN)
      const user = req.user!;
      const child = await prisma.child.findUnique({ where: { id: childId } });
      if (!child) {
        res.status(404).json({ error: "Child not found" });
        return;
      }
      const canWrite =
        user.role !== "PARENT" || child.parentId === user.sub;
      if (!canWrite) {
        res.status(403).json({ error: "Access denied to this child's records" });
        return;
      }

      await prisma.growthMetric.create({
        data: {
          childId,
          ageMonths,
          heightCm,
          weightKg,
          heightPercentile: result.heightPercentile,
          weightPercentile: result.weightPercentile,
          bmiPercentile: result.bmiPercentile,
        },
      });
    }

    res.json({
      success: true,
      data: result,
      ...(childId ? { persisted: true } : {}),
    });
  }
);

/**
 * GET /api/metrics/history/:childId
 *
 * Returns the full growth metric history for a child.
 */
router.get(
  "/history/:childId",
  authenticate,
  requireChildAccess("childId"),
  async (req: Request, res: Response) => {
    const metrics = await prisma.growthMetric.findMany({
      where: { childId: req.params.childId },
      orderBy: { recordedAt: "asc" },
    });
    res.json({ success: true, data: metrics });
  }
);

export default router;
