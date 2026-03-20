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

function toNonNegativeNumber(value) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return parsed
}

function toRounded(value, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function calculateAttendanceCourseMetrics(record) {
  const delivered = toNonNegativeNumber(record?.total_delivered ?? record?.delivered)
  const attended = toNonNegativeNumber(record?.total_attended ?? record?.attended)
  const declaredCredits = Number(record?.course?.credits ?? record?.credits ?? 0)
  const hasDeclaredCredits = Number.isFinite(declaredCredits) && declaredCredits > 0
  const inferredCredits = inferCreditsFromDeliveredClasses(delivered)
  const credits = hasDeclaredCredits ? declaredCredits : inferredCredits

  const totalClasses = getCourseClassTarget(credits)
  const isCompleted = totalClasses > 0 && delivered >= totalClasses
  const currentAbsences = Math.max(0, delivered - attended)
  const safeSkips = currentAbsences <= credits ? credits - currentAbsences : 0
  const exceededAbsences = Math.max(0, currentAbsences - credits)
  const gradePenalty = toRounded(exceededAbsences * 0.25)
  const attendancePercentage = delivered > 0 ? toRounded((attended / delivered) * 100) : 0
  const remainingClasses = Math.max(0, totalClasses - delivered)

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
    remainingClasses,
    atAbsenceLimit: !isCompleted && safeSkips === 0 && gradePenalty === 0,
    inPenaltyZone: gradePenalty > 0,
    creditsInferred: !hasDeclaredCredits && inferredCredits > 0,
  }
}

export function getAttendanceInsights(record) {
  const metrics = calculateAttendanceCourseMetrics(record)
  const requiresAttention = metrics.totalClasses > 0 && !metrics.isCompleted && metrics.safeSkips === 0

  return {
    credits: metrics.credits,
    totalDelivered: metrics.delivered,
    totalAttended: metrics.attended,
    totalMissed: metrics.currentAbsences,
    classTarget: metrics.totalClasses,
    allowedAbsences: metrics.credits,
    remainingAllowedAbsences: metrics.safeSkips,
    remainingClasses: metrics.remainingClasses,
    courseCompleted: metrics.isCompleted,
    requiresAttention,
    creditsInferred: metrics.creditsInferred,
    isCompleted: metrics.isCompleted,
    safeSkips: metrics.safeSkips,
    currentAbsences: metrics.currentAbsences,
    gradePenalty: metrics.gradePenalty,
    attendancePercentage: metrics.attendancePercentage,
    atAbsenceLimit: metrics.atAbsenceLimit,
    inPenaltyZone: metrics.inPenaltyZone,
  }
}
