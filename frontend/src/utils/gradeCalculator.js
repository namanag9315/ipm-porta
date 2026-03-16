const MAX_GPA = 4.33

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function calculateWeightedGPA(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 0
  }

  let weightedPoints = 0
  let totalCredits = 0

  for (const entry of entries) {
    const credits = toFiniteNumber(entry?.credits)
    const gradePoint = toFiniteNumber(entry?.gradePoint, NaN)
    if (credits <= 0 || !Number.isFinite(gradePoint)) {
      continue
    }
    weightedPoints += credits * gradePoint
    totalCredits += credits
  }

  if (totalCredits <= 0) {
    return 0
  }

  return weightedPoints / totalCredits
}

export function convertToPercentage(gpa) {
  const cgpa = toFiniteNumber(gpa, NaN)
  if (!Number.isFinite(cgpa)) {
    return 0
  }

  if (cgpa > 3.5 && cgpa <= MAX_GPA) {
    return 91 + (cgpa - 3.5) * 10.8434
  }
  if (cgpa > 2.3 && cgpa <= 3.5) {
    return 60 + (cgpa - 2.3) * 25.8334
  }
  if (cgpa >= 2 && cgpa <= 2.3) {
    return 50 + (cgpa - 2) * 33.3334
  }
  if (cgpa >= 1 && cgpa < 2) {
    return 20 + (cgpa - 1) * 30
  }
  if (cgpa > MAX_GPA) {
    return 100
  }
  if (cgpa > 0 && cgpa < 1) {
    return 20 * cgpa
  }
  return 0
}

export function convertPercentageToGPA(percentage) {
  const pct = Math.max(0, Math.min(100, toFiniteNumber(percentage, 0)))

  if (pct > 91) {
    return 3.5 + (pct - 91) / 10.8434
  }
  if (pct > 60) {
    return 2.3 + (pct - 60) / 25.8334
  }
  if (pct >= 50) {
    return 2 + (pct - 50) / 33.3334
  }
  if (pct >= 20) {
    return 1 + (pct - 20) / 30
  }
  return pct / 20
}

export function calculateRequiredGPA(
  currentGPA,
  currentCredits,
  targetPercentage,
  remainingCredits,
) {
  const gpaNow = toFiniteNumber(currentGPA, NaN)
  const doneCredits = toFiniteNumber(currentCredits, NaN)
  const leftCredits = toFiniteNumber(remainingCredits, NaN)

  if (!Number.isFinite(gpaNow) || !Number.isFinite(doneCredits) || !Number.isFinite(leftCredits) || leftCredits <= 0) {
    return NaN
  }

  const targetGPA = convertPercentageToGPA(targetPercentage)
  const required =
    ((targetGPA * (doneCredits + leftCredits)) - (gpaNow * doneCredits)) / leftCredits
  return required
}

export const GRADE_SIMULATOR_CONSTANTS = {
  MAX_GPA,
}
