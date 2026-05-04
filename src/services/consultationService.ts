import { ConsultationStatus, EscalationTrigger } from "@prisma/client";
import prisma from "../config/prisma";
import { EscalateInput, EscalateResult } from "../types";

/**
 * Transitions a Consultation from AI_MANAGED → ESCALATING → DOCTOR_MANAGED.
 *
 * The state machine:
 *
 *   AI_MANAGED ──(escalate)──► ESCALATING ──(doctor accepts)──► DOCTOR_MANAGED
 *                                                                      │
 *                                                               (resolve/close)
 *                                                                      ▼
 *                                                                   CLOSED
 *
 * Only AI_MANAGED and ESCALATING consultations can be escalated further.
 * DOCTOR_MANAGED and CLOSED are terminal for this transition.
 */
export async function escalateConsultation(
  input: EscalateInput,
  requestingUserId: string
): Promise<EscalateResult> {
  const consultation = await prisma.consultation.findUnique({
    where: { id: input.consultationId },
    include: {
      child: true,
      parent: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!consultation) {
    throw Object.assign(new Error("Consultation not found"), { statusCode: 404 });
  }

  const allowed: ConsultationStatus[] = [
    ConsultationStatus.AI_MANAGED,
    ConsultationStatus.ESCALATING,
  ];
  if (!allowed.includes(consultation.status)) {
    throw Object.assign(
      new Error(
        `Cannot escalate a consultation in status '${consultation.status}'. It must be AI_MANAGED or ESCALATING.`
      ),
      { statusCode: 409 }
    );
  }

  const previousStatus = consultation.status;

  // Find an available doctor in the preferred region
  const doctor = await findAvailableDoctor(input.preferredRegion);

  const newStatus = doctor
    ? ConsultationStatus.ESCALATING  // Doctor found; awaiting acceptance
    : ConsultationStatus.ESCALATING; // Still ESCALATING until doctor accepts

  const updated = await prisma.consultation.update({
    where: { id: input.consultationId },
    data: {
      status: newStatus,
      escalationTrigger: input.trigger,
      escalatedAt: new Date(),
      doctorId: doctor?.userId ?? null,
      // Snapshot of the last AI guidance for doctor context is set by the
      // calling route after the AI guidance response is stored
    },
  });

  // Persist the parent's escalation note if provided
  if (input.parentNotes) {
    await prisma.consultationNote.create({
      data: {
        consultationId: input.consultationId,
        authorId: requestingUserId,
        content: input.parentNotes,
        isVisibleToParent: true,
      },
    });
  }

  return {
    consultationId: updated.id,
    previousStatus,
    newStatus: updated.status,
    assignedDoctorId: doctor?.userId,
    assignedDoctorName: doctor
      ? `${doctor.user.firstName} ${doctor.user.lastName}`
      : undefined,
    message: doctor
      ? `Your case has been escalated and assigned to Dr. ${doctor.user.lastName} in ${doctor.region}. They will review and contact you shortly.`
      : "Your case has been escalated. A doctor in your region will be assigned shortly.",
  };
}

/**
 * Finds an available doctor, optionally filtered by region.
 * Returns null if no doctor is currently accepting cases.
 */
async function findAvailableDoctor(preferredRegion?: string) {
  return prisma.doctorProfile.findFirst({
    where: {
      isAcceptingCases: true,
      ...(preferredRegion ? { region: preferredRegion } : {}),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" }, // round-robin approximation; replace with load-balancing logic
  });
}

/**
 * Transitions ESCALATING → DOCTOR_MANAGED once the assigned doctor accepts.
 * Only the assigned doctor may call this.
 */
export async function acceptConsultation(
  consultationId: string,
  doctorUserId: string
): Promise<void> {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    select: { status: true, doctorId: true },
  });

  if (!consultation) {
    throw Object.assign(new Error("Consultation not found"), { statusCode: 404 });
  }
  if (consultation.status !== ConsultationStatus.ESCALATING) {
    throw Object.assign(
      new Error("Only ESCALATING consultations can be accepted"),
      { statusCode: 409 }
    );
  }
  if (consultation.doctorId !== doctorUserId) {
    throw Object.assign(
      new Error("Only the assigned doctor may accept this consultation"),
      { statusCode: 403 }
    );
  }

  await prisma.consultation.update({
    where: { id: consultationId },
    data: {
      status: ConsultationStatus.DOCTOR_MANAGED,
      doctorAcceptedAt: new Date(),
    },
  });
}

/**
 * Closes a consultation. Available to the assigned doctor or an Admin.
 */
export async function closeConsultation(consultationId: string): Promise<void> {
  await prisma.consultation.update({
    where: { id: consultationId },
    data: { status: ConsultationStatus.CLOSED, closedAt: new Date() },
  });
}
