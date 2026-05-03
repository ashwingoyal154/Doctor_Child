import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import prisma from "../config/prisma";

/**
 * Factory that returns a middleware allowing only the specified roles.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Verifies that the authenticated parent owns the requested child.
 * Attaches the resolved child to req for downstream use.
 * Doctors and Admins bypass the ownership check.
 */
export function requireChildAccess(childIdParam = "childId") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user!;
    const childId: string =
      req.params[childIdParam] ??
      req.body[childIdParam] ??
      req.query[childIdParam];

    if (!childId) {
      res.status(400).json({ error: `Missing ${childIdParam}` });
      return;
    }

    if (user.role === Role.DOCTOR || user.role === Role.ADMIN) {
      next();
      return;
    }

    // PARENT: enforce ownership
    const child = await prisma.child.findUnique({ where: { id: childId } });
    if (!child || child.parentId !== user.sub) {
      res.status(403).json({ error: "Access denied to this child's records" });
      return;
    }
    next();
  };
}

/**
 * Filters a list of HealthRecord objects so that PARENT users only receive
 * records where isVisibleToParent === true.
 *
 * Used as a data-layer guard — call this before serialising any HealthRecord
 * arrays to a response.
 */
export function filterHealthRecordsForRole<
  T extends { isVisibleToParent: boolean }
>(records: T[], role: Role): T[] {
  if (role === Role.PARENT) {
    return records.filter((r) => r.isVisibleToParent);
  }
  return records; // DOCTOR and ADMIN see everything
}

/**
 * Verifies the requesting user is the author of a HealthRecord, or an ADMIN.
 * Prevents a doctor from editing another doctor's records.
 */
export async function requireHealthRecordAuthor(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const user = req.user!;
  const recordId: string = req.params.recordId ?? req.body.recordId;

  if (user.role === Role.ADMIN) {
    next();
    return;
  }

  const record = await prisma.healthRecord.findUnique({
    where: { id: recordId },
    select: { authorId: true },
  });

  if (!record) {
    res.status(404).json({ error: "Health record not found" });
    return;
  }
  if (record.authorId !== user.sub) {
    res.status(403).json({ error: "Only the authoring doctor may modify this record" });
    return;
  }
  next();
}

/**
 * Verifies the requesting PARENT owns the consultation being accessed.
 * Doctors assigned to that consultation and Admins bypass this check.
 */
export function requireConsultationAccess(consultationIdParam = "consultationId") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user!;
    const consultationId: string =
      req.params[consultationIdParam] ??
      req.body[consultationIdParam];

    if (!consultationId) {
      res.status(400).json({ error: `Missing ${consultationIdParam}` });
      return;
    }

    if (user.role === Role.ADMIN) {
      next();
      return;
    }

    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { parentId: true, doctorId: true },
    });

    if (!consultation) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }

    const isOwningParent = user.role === Role.PARENT && consultation.parentId === user.sub;
    const isAssignedDoctor = user.role === Role.DOCTOR && consultation.doctorId === user.sub;

    if (!isOwningParent && !isAssignedDoctor) {
      res.status(403).json({ error: "Access denied to this consultation" });
      return;
    }
    next();
  };
}
