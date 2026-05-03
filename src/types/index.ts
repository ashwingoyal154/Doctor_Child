import { Role, ConsultationStatus, EscalationTrigger, HealthCondition } from "@prisma/client";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;  // User.id
  role: Role;
  email: string;
  iat?: number;
  exp?: number;
}

// Attached to req by the auth middleware
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─── Percentile ───────────────────────────────────────────────────────────────

export interface CalculatePercentileInput {
  ageMonths: number;
  heightCm: number;
  weightKg: number;
  gender: "male" | "female";
  childId?: string;  // If provided, the result is persisted to GrowthMetric
}

export interface PercentileResult {
  ageMonths: number;
  heightCm: number;
  weightKg: number;
  bmi: number;
  heightPercentile: number;
  weightPercentile: number;
  bmiPercentile: number;
  interpretation: PercentileInterpretation;
}

export interface PercentileInterpretation {
  heightStatus: GrowthStatus;
  weightStatus: GrowthStatus;
  bmiStatus: GrowthStatus;
  clinicalFlags: string[];  // Populated when values cross escalation thresholds
}

export type GrowthStatus =
  | "severely_low"    // < 3rd percentile
  | "low"             // 3rd–10th percentile
  | "normal"          // 10th–85th percentile
  | "high"            // 85th–97th percentile
  | "severely_high";  // > 97th percentile

// ─── AI Guidance ──────────────────────────────────────────────────────────────

export interface AiGuidanceInput {
  childId: string;
  consultationId?: string;
  latestMetrics: CalculatePercentileInput;
  healthConditions: HealthCondition[];
  parentConcerns?: string;
}

export interface AiGuidanceResult {
  consultationId: string;
  recommendations: NutritionRecommendation[];
  supplementRecommendations: SupplementRecommendation[];
  escalationAdvised: boolean;
  escalationReason?: string;
  modelVersion: string;
  generatedAt: string;
}

export interface NutritionRecommendation {
  category: string;
  guidance: string;
  priority: "high" | "medium" | "low";
}

export interface SupplementRecommendation {
  name: string;
  dosage: string;
  frequency: string;
  rationale: string;
  requiresDoctorApproval: boolean;
}

// ─── Consultation / Escalation ────────────────────────────────────────────────

export interface EscalateInput {
  consultationId: string;
  trigger: EscalationTrigger;
  parentNotes?: string;
  preferredRegion?: string;
}

export interface EscalateResult {
  consultationId: string;
  previousStatus: ConsultationStatus;
  newStatus: ConsultationStatus;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  message: string;
}
