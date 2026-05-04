import { GrowthStatus, PercentileInterpretation, PercentileResult } from "../types";

// ─── WHO/CDC Z-score LMS approximation ───────────────────────────────────────
//
// A production implementation would load the full WHO Child Growth Standards
// LMS tables (L, M, S values per age/sex) from a static data file and apply
// Box-Cox transformation.  The stubs below implement a simplified z-score
// approach sufficient for scaffolding; replace computePercentile() with the
// full LMS lookup when the official data tables are integrated.

function erf(x: number): number {
  // Abramowitz & Stegun approximation (max error 1.5e-7)
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

function zScoreToPercentile(z: number): number {
  return ((1 + erf(z / Math.SQRT2)) / 2) * 100;
}

/**
 * Stub: returns a synthetic z-score.
 * Replace with a proper LMS table lookup keyed on (ageMonths, gender, measurement).
 */
function computeZScore(
  value: number,
  ageMonths: number,
  gender: "male" | "female",
  measurement: "height" | "weight" | "bmi"
): number {
  // WHO median and SD approximations (simplified — not for clinical use as-is)
  const medians: Record<string, Record<string, number>> = {
    height: { male: 50 + ageMonths * 1.2, female: 49 + ageMonths * 1.15 },
    weight: { male: 3.5 + ageMonths * 0.18, female: 3.3 + ageMonths * 0.17 },
    bmi:    { male: 14.5 + ageMonths * 0.01, female: 14.2 + ageMonths * 0.01 },
  };
  const sds: Record<string, number> = { height: 3.5, weight: 0.8, bmi: 1.2 };

  const median = medians[measurement][gender];
  const sd = sds[measurement];
  return (value - median) / sd;
}

function classifyPercentile(p: number): GrowthStatus {
  if (p < 3) return "severely_low";
  if (p < 10) return "low";
  if (p < 85) return "normal";
  if (p < 97) return "high";
  return "severely_high";
}

function buildInterpretation(
  hP: number,
  wP: number,
  bmiP: number
): PercentileInterpretation {
  const hS = classifyPercentile(hP);
  const wS = classifyPercentile(wP);
  const bmiS = classifyPercentile(bmiP);

  const flags: string[] = [];

  if (hS === "severely_low")
    flags.push("Height below 3rd percentile — evaluate for growth hormone deficiency or chronic illness.");
  if (wS === "severely_low")
    flags.push("Weight below 3rd percentile — evaluate for failure to thrive.");
  if (bmiS === "severely_high")
    flags.push("BMI above 97th percentile — clinical obesity; consider endocrine/metabolic workup.");
  if (wS === "severely_high" && hS !== "severely_high")
    flags.push("Weight disproportionate to height — monitor for metabolic syndrome risk.");

  return { heightStatus: hS, weightStatus: wS, bmiStatus: bmiS, clinicalFlags: flags };
}

export function calculatePercentiles(
  ageMonths: number,
  heightCm: number,
  weightKg: number,
  gender: "male" | "female"
): PercentileResult {
  const bmi = weightKg / (heightCm / 100) ** 2;

  const hZ = computeZScore(heightCm, ageMonths, gender, "height");
  const wZ = computeZScore(weightKg, ageMonths, gender, "weight");
  const bmiZ = computeZScore(bmi, ageMonths, gender, "bmi");

  const hP = Math.round(zScoreToPercentile(hZ) * 10) / 10;
  const wP = Math.round(zScoreToPercentile(wZ) * 10) / 10;
  const bmiP = Math.round(zScoreToPercentile(bmiZ) * 10) / 10;

  return {
    ageMonths,
    heightCm,
    weightKg,
    bmi: Math.round(bmi * 10) / 10,
    heightPercentile: hP,
    weightPercentile: wP,
    bmiPercentile: bmiP,
    interpretation: buildInterpretation(hP, wP, bmiP),
  };
}
