import { Router, Request, Response } from "express";
import { z } from "zod";
import { EscalationTrigger, Role } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { requireRole, requireConsultationAccess, filterHealthRecordsForRole } from "../middleware/rbac";
import {
  escalateConsultation,
  acceptConsultation,
  closeConsultation,
} from "../services/consultationService";
import prisma from "../config/prisma";

const router = Router();

// ─── Escalate ─────────────────────────────────────────────────────────────────

const EscalateSchema = z.object({
  consultationId: z.string().cuid(),
  trigger: z.nativeEnum(EscalationTrigger).default(EscalationTrigger.USER_REQUESTED),
  parentNotes: z.string().max(2000).optional(),
  preferredRegion: z.string().optional(),
});

/**
 * POST /api/consultations/escalate
 *
 * Transitions a consultation from AI_MANAGED → ESCALATING and attempts to
 * assign a regional doctor.  Accessible by PARENT (own consultations) or ADMIN.
 */
router.post(
  "/escalate",
  authenticate,
  requireRole("PARENT", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = EscalateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    // Guard: parent can only escalate their own consultations
    if (req.user!.role === Role.PARENT) {
      const consultation = await prisma.consultation.findUnique({
        where: { id: parsed.data.consultationId },
        select: { parentId: true },
      });
      if (!consultation || consultation.parentId !== req.user!.sub) {
        res.status(403).json({ error: "Access denied to this consultation" });
        return;
      }
    }

    const result = await escalateConsultation(parsed.data, req.user!.sub);
    res.json({ success: true, data: result });
  }
);

// ─── Accept (Doctor accepts assignment) ──────────────────────────────────────

/**
 * POST /api/consultations/:consultationId/accept
 *
 * Transitions ESCALATING → DOCTOR_MANAGED.  Only the assigned doctor may call this.
 */
router.post(
  "/:consultationId/accept",
  authenticate,
  requireRole("DOCTOR"),
  async (req: Request, res: Response) => {
    await acceptConsultation(req.params.consultationId, req.user!.sub);
    res.json({ success: true, message: "Consultation accepted. You are now the managing physician." });
  }
);

// ─── Close ────────────────────────────────────────────────────────────────────

/**
 * POST /api/consultations/:consultationId/close
 *
 * Closes a consultation. Available to the assigned doctor or ADMIN.
 */
router.post(
  "/:consultationId/close",
  authenticate,
  requireRole("DOCTOR", "ADMIN"),
  requireConsultationAccess("consultationId"),
  async (req: Request, res: Response) => {
    await closeConsultation(req.params.consultationId);
    res.json({ success: true, message: "Consultation closed." });
  }
);

// ─── Get consultation detail ──────────────────────────────────────────────────

/**
 * GET /api/consultations/:consultationId
 *
 * Returns full consultation data.  HealthRecords are filtered by
 * isVisibleToParent when the caller is a PARENT.
 */
router.get(
  "/:consultationId",
  authenticate,
  requireConsultationAccess("consultationId"),
  async (req: Request, res: Response) => {
    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.consultationId },
      include: {
        child: true,
        parent: { select: { id: true, firstName: true, lastName: true, email: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          where:
            req.user!.role === Role.PARENT
              ? { isVisibleToParent: true }
              : {},
          orderBy: { createdAt: "asc" },
        },
        healthRecords: true,
      },
    });

    if (!consultation) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }

    // Apply RBAC filter to health records
    const filteredRecords = filterHealthRecordsForRole(
      consultation.healthRecords,
      req.user!.role
    );

    res.json({
      success: true,
      data: { ...consultation, healthRecords: filteredRecords },
    });
  }
);

// ─── List consultations for a child ──────────────────────────────────────────

/**
 * GET /api/consultations/child/:childId
 *
 * Returns all consultations for a child (parent sees their own children,
 * doctors see their assigned consultations, admin sees all).
 */
router.get(
  "/child/:childId",
  authenticate,
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { childId } = req.params;

    let whereClause: object = { childId };
    if (user.role === Role.PARENT) {
      whereClause = { childId, parentId: user.sub };
    } else if (user.role === Role.DOCTOR) {
      whereClause = { childId, doctorId: user.sub };
    }

    const consultations = await prisma.consultation.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, data: consultations });
  }
);

// ─── Health Records sub-resource ─────────────────────────────────────────────

const HealthRecordSchema = z.object({
  childId: z.string().cuid(),
  consultationId: z.string().cuid().optional(),
  condition: z.enum([
    "CHRONIC_CONSTIPATION",
    "THYROID",
    "B12_DEFICIENCY",
    "LIVER_DISEASE",
    "OTHER",
  ]),
  conditionDetail: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  diagnosedAt: z.string().datetime().optional(),
  isVisibleToParent: z.boolean().default(false),
});

/**
 * POST /api/consultations/health-records
 *
 * Creates a HealthRecord.  Only DOCTOR and ADMIN may author records.
 * isVisibleToParent defaults to false — the doctor must explicitly grant visibility.
 */
router.post(
  "/health-records",
  authenticate,
  requireRole("DOCTOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = HealthRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const record = await prisma.healthRecord.create({
      data: {
        ...parsed.data,
        authorId: req.user!.sub,
        diagnosedAt: parsed.data.diagnosedAt ? new Date(parsed.data.diagnosedAt) : undefined,
      },
    });

    res.status(201).json({ success: true, data: record });
  }
);

/**
 * PATCH /api/consultations/health-records/:recordId/visibility
 *
 * Toggles isVisibleToParent on a HealthRecord.
 * Only the authoring doctor or ADMIN may change this flag.
 */
router.patch(
  "/health-records/:recordId/visibility",
  authenticate,
  requireRole("DOCTOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const { isVisibleToParent } = z
      .object({ isVisibleToParent: z.boolean() })
      .parse(req.body);

    const record = await prisma.healthRecord.findUnique({
      where: { id: req.params.recordId },
      select: { authorId: true },
    });
    if (!record) {
      res.status(404).json({ error: "Health record not found" });
      return;
    }
    if (req.user!.role !== Role.ADMIN && record.authorId !== req.user!.sub) {
      res.status(403).json({ error: "Only the authoring doctor may update visibility" });
      return;
    }

    const updated = await prisma.healthRecord.update({
      where: { id: req.params.recordId },
      data: { isVisibleToParent },
    });

    res.json({ success: true, data: updated });
  }
);

export default router;
