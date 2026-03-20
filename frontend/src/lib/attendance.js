export function getCourseClassTarget(credits) {
  const normalizedCredits = Number(credits || 0)
  if (!Number.isFinite(normalizedCredits) || normalizedCredits <= 0) {
    return 0
  }
  return normalizedCredits * 5
}

export function getAllowedAbsences(credits) {
  const normalizedCredits = Number(credits || 0)
  if (!Number.isFinite(normalizedCredits) || normalizedCredits <= 0) {
    return 0
  }
  return normalizedCredits
}

function inferCreditsFromDeliveredClasses(totalDelivered) {
  const delivered = Number(totalDelivered || 0)
  if (!Number.isFinite(delivered) || delivered <= 0) {
    return 0
  }
  if (delivered <= 10) {
    return 2
  }
  if (delivered <= 15) {
    return 3
  }
  return 4
}

function normalizeNonNegative(value) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return parsed
}

function roundTo(value, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function calculateAttendanceCourseMetrics(record) {
  const delivered = normalizeNonNegative(record?.total_delivered ?? record?.delivered)
  const attended = normalizeNonNegative(record?.total_attended ?? record?.attended)
  const declaredCredits = Number(record?.course?.credits ?? record?.credits ?? 0)
  const hasDeclaredCredits = Number.isFinite(declaredCredits) && declaredCredits > 0
  const inferredCredits = inferCreditsFromDeliveredClasses(delivered)
  const credits = hasDeclaredCredits ? declaredCredits : inferredCredits

  const totalClasses = getCourseClassTarget(credits)
  const isCompleted = totalClasses > 0 && delivered >= totalClasses
  const currentAbsences = Math.max(0, delivered - attended)
  const safeSkips = currentAbsences <= credits ? credits - currentAbsences : 0
  const exceededAbsences = Math.max(0, currentAbsences - credits)
  const gradePenalty = roundTo(exceededAbsences * 0.25)
  const attendancePercentage = delivered > 0 ? roundTo((attended / delivered) * 100) : 0

  return {
    credits,
    delivered,
    attended,
    totalClasses,
    isCompleted,
    currentAbsences,
    safeSkips,
    gradePenalty,
    attendancePercentage,
    creditsInferred: !hasDeclaredCredits && inferredCredits > 0,
  }
}

export function getAttendanceInsights(record) {
  const metrics = calculateAttendanceCourseMetrics(record)
  const remainingClasses = Math.max(0, metrics.totalClasses - metrics.delivered)
  const requiresAttention = metrics.totalClasses > 0 ? !metrics.isCompleted && metrics.safeSkips === 0 : false

  return {
    credits: metrics.credits,
    totalDelivered: metrics.delivered,
    totalAttended: metrics.attended,
    totalMissed: metrics.currentAbsences,
    classTarget: metrics.totalClasses,
    allowedAbsences: metrics.credits,
    remainingAllowedAbsences: metrics.safeSkips,
    remainingClasses,
    courseCompleted: metrics.isCompleted,
    requiresAttention,
    creditsInferred: metrics.creditsInferred,
    safeSkips: metrics.safeSkips,
    gradePenalty: metrics.gradePenalty,
    currentAbsences: metrics.currentAbsences,
    isCompleted: metrics.isCompleted,
    attendancePercentage: metrics.attendancePercentage,
  }
}
