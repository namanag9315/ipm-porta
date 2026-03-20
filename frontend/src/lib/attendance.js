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

export function getAttendanceInsights(record) {
  const totalDelivered = Number(record?.total_delivered || 0)
  const totalAttended = Number(record?.total_attended || 0)
  const totalMissed = Math.max(0, totalDelivered - totalAttended)
  const declaredCredits = Number(record?.course?.credits || 0)
  const hasDeclaredCredits = Number.isFinite(declaredCredits) && declaredCredits > 0
  const inferredCredits = inferCreditsFromDeliveredClasses(totalDelivered)
  const credits = hasDeclaredCredits ? declaredCredits : inferredCredits
  const classTarget = getCourseClassTarget(credits)
  const allowedAbsences = getAllowedAbsences(credits)
  const remainingAllowedAbsences = Math.max(0, allowedAbsences - totalMissed)
  const remainingClasses = Math.max(0, classTarget - totalDelivered)
  const courseCompleted = classTarget > 0 && totalDelivered >= classTarget
  const requiresAttention =
    classTarget > 0 ? !courseCompleted && totalMissed >= allowedAbsences : false

  return {
    credits,
    totalDelivered,
    totalAttended,
    totalMissed,
    classTarget,
    allowedAbsences,
    remainingAllowedAbsences,
    remainingClasses,
    courseCompleted,
    requiresAttention,
    creditsInferred: !hasDeclaredCredits && inferredCredits > 0,
  }
}
