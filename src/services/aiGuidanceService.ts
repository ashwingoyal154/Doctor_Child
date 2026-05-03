import { HealthCondition } from "@prisma/client";
import {
  AiGuidanceInput,
  AiGuidanceResult,
  NutritionRecommendation,
  SupplementRecommendation,
} from "../types";
import { calculatePercentiles } from "./percentileService";

// ─── Proprietary Model Interface ──────────────────────────────────────────────
//
// THIS IS THE INTEGRATION POINT FOR THE PROPRIETARY PEDIATRIC MODEL.
//
// Replace `runProprietaryModel` with your actual model invocation (HTTP call,
// gRPC, local inference, etc.).  The function contract must remain stable:
// accept PediatricModelInput and return PediatricModelOutput.
//
// Everything outside this function is production-ready scaffolding.

interface PediatricModelInput {
  ageMonths: number;
  gender: string;
  heightPercentile: number;
  weightPercentile: number;
  bmiPercentile: number;
  conditions: HealthCondition[];
  parentConcerns?: string;
}

interface PediatricModelOutput {
  nutritionRecommendations: NutritionRecommendation[];
  supplementRecommendations: SupplementRecommendation[];
  escalationAdvised: boolean;
  escalationReason?: string;
}

// ── STUB — replace with real model call ──────────────────────────────────────
async function runProprietaryModel(
  input: PediatricModelInput
): Promise<PediatricModelOutput> {
  const nutrition: NutritionRecommendation[] = [
    {
      category: "Macronutrients",
      guidance: `Age-appropriate caloric target: ${Math.round(900 + input.ageMonths * 10)} kcal/day. Prioritise whole grains, lean protein, and healthy fats.`,
      priority: "high",
    },
    {
      category: "Hydration",
      guidance: `${Math.round(600 + input.ageMonths * 8)} ml/day of water. Avoid sugar-sweetened beverages.`,
      priority: "medium",
    },
  ];

  const supplements: SupplementRecommendation[] = [
    {
      name: "Vitamin D3",
      dosage: "400 IU",
      frequency: "daily",
      rationale: "Standard preventive supplementation for pediatric bone health.",
      requiresDoctorApproval: false,
    },
  ];

  // Condition-specific guidance stubs
  if (input.conditions.includes(HealthCondition.B12_DEFICIENCY)) {
    supplements.push({
      name: "Methylcobalamin (B12)",
      dosage: "500 mcg",
      frequency: "daily",
      rationale: "Targeted supplementation for documented B12 deficiency.",
      requiresDoctorApproval: true,
    });
  }
  if (input.conditions.includes(HealthCondition.CHRONIC_CONSTIPATION)) {
    nutrition.push({
      category: "Fibre",
      guidance: `Target ${input.ageMonths < 24 ? 14 : 19}g fibre/day. Increase fruits, vegetables, and legumes gradually.`,
      priority: "high",
    });
  }

  // Escalation criteria
  const escalationAdvised =
    input.bmiPercentile > 97 ||
    input.weightPercentile < 3 ||
    input.heightPercentile < 3 ||
    input.conditions.includes(HealthCondition.THYROID) ||
    input.conditions.includes(HealthCondition.LIVER_DISEASE);

  const escalationReason = escalationAdvised
    ? buildEscalationReason(input)
    : undefined;

  return { nutritionRecommendations: nutrition, supplementRecommendations: supplements, escalationAdvised, escalationReason };
}

function buildEscalationReason(input: PediatricModelInput): string {
  const reasons: string[] = [];
  if (input.bmiPercentile > 97) reasons.push("BMI > 97th percentile");
  if (input.weightPercentile < 3) reasons.push("Weight < 3rd percentile");
  if (input.heightPercentile < 3) reasons.push("Height < 3rd percentile");
  if (input.conditions.includes(HealthCondition.THYROID)) reasons.push("Thyroid condition requires physician oversight");
  if (input.conditions.includes(HealthCondition.LIVER_DISEASE)) reasons.push("Liver disease requires physician oversight");
  return `Clinical escalation criteria met: ${reasons.join("; ")}.`;
}
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_VERSION = "stub-v0.1.0"; // update when the real model is wired in

export async function generateAiGuidance(
  input: AiGuidanceInput
): Promise<AiGuidanceResult> {
  const percentiles = calculatePercentiles(
    input.latestMetrics.ageMonths,
    input.latestMetrics.heightCm,
    input.latestMetrics.weightKg,
    input.latestMetrics.gender
  );

  const modelInput: PediatricModelInput = {
    ageMonths: input.latestMetrics.ageMonths,
    gender: input.latestMetrics.gender,
    heightPercentile: percentiles.heightPercentile,
    weightPercentile: percentiles.weightPercentile,
    bmiPercentile: percentiles.bmiPercentile,
    conditions: input.healthConditions,
    parentConcerns: input.parentConcerns,
  };

  const modelOutput = await runProprietaryModel(modelInput);

  return {
    consultationId: input.consultationId ?? "pending",
    recommendations: modelOutput.nutritionRecommendations,
    supplementRecommendations: modelOutput.supplementRecommendations,
    escalationAdvised: modelOutput.escalationAdvised,
    escalationReason: modelOutput.escalationReason,
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
  };
}
