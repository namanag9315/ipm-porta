import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileUp,
  ShieldCheck,
  ShieldAlert,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { calculateAttendanceCourseMetrics, getAttendanceInsights } from '../lib/attendance'
import { cn } from '../lib/cn'

const ATTENDANCE_MASTER_SHEET_URL =
  import.meta.env.VITE_ATTENDANCE_MASTER_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/1Qp3zn4qFAcnyRzsA3kTiaMkm0W46BnUXtCQf08jCjPs/edit'

const COURSE_COLOR_CLASSES = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-violet-500',
  'border-l-amber-500',
  'border-l-cyan-500',
  'border-l-fuchsia-500',
  'border-l-orange-500',
]

function percentageTone(percentage) {
  if (percentage >= 85) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (percentage >= 75) {
    return 'bg-amber-100 text-amber-700'
  }
  return 'bg-rose-100 text-rose-700'
}

function waiverStatusTone(status) {
  if (status === 'approved') {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (status === 'rejected') {
    return 'bg-rose-100 text-rose-700'
  }
  return 'bg-amber-100 text-amber-700'
}

function normalizeCourseDisplayName(value) {
  const cleaned = String(value || '')
    .replace(/\bsection\s*[AB]\b/gi, '')
    .replace(/\s+\b[AB]\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Unknown Course'
}

function courseColorClass(courseCode) {
  const normalized = String(courseCode || 'NA')
  const hash = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return COURSE_COLOR_CLASSES[hash % COURSE_COLOR_CLASSES.length]
}

function formatSubmittedAt(value) {
  if (!value) {
    return ''
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  return parsed.toLocaleString()
}

function getActionCenterTone(insights) {
  if (insights.isCompleted) {
    return {
      container: 'border-slate-200 bg-slate-50 text-slate-800',
      badge: 'bg-slate-200/70 text-slate-700',
      icon: CheckCircle2,
      title: 'Course Completed',
      detail:
        insights.gradePenalty > 0
          ? `Closed with penalty: -${insights.gradePenalty.toFixed(2)} grade points`
          : 'Closed safely within the attendance mandate',
    }
  }

  if (insights.inPenaltyZone) {
    return {
      container: 'border-rose-200 bg-rose-50 text-rose-900',
      badge: 'bg-rose-100 text-rose-700',
      icon: XCircle,
      title: `Grade Penalty Active: -${insights.gradePenalty.toFixed(2)} points`,
      detail: `${insights.currentAbsences} absences vs ${insights.credits} allowed`,
    }
  }

  if (insights.atAbsenceLimit) {
    return {
      container: 'border-amber-200 bg-amber-50 text-amber-900',
      badge: 'bg-amber-100 text-amber-800',
      icon: AlertTriangle,
      title: 'No more absences allowed (0 safe skips)',
      detail: 'Any new absence will trigger grade-point deduction',
    }
  }

  return {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: ShieldCheck,
    title: `Safe to miss ${insights.safeSkips} more classes`,
    detail: `${insights.currentAbsences} absences used out of ${insights.credits}`,
  }
}

function getChartBarColor(course) {
  if (course.insights.isCompleted) {
    return '#64748b'
  }
  if (course.chartAttendancePercent < 80) {
    return '#ef4444'
  }
  return '#10b981'
}

export default function AttendanceView() {
  const { user } = useAuth()
  const [records, setRecords] = useState([])
  const [waivers, setWaivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [waiverError, setWaiverError] = useState('')
  const [waiverSuccess, setWaiverSuccess] = useState('')
  const [waiverSubmitting, setWaiverSubmitting] = useState(false)
  const [waiverForm, setWaiverForm] = useState({
    courseCode: '',
    reason: '',
    file: null,
  })
  const [fileInputKey, setFileInputKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadAttendance() {
      if (!user?.rollNumber) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const [attendanceResult, waiverResult] = await Promise.allSettled([
          api.get(`/api/v1/attendance/${user.rollNumber}/`, {
            signal: controller.signal,
          }),
          api.get(`/api/v1/attendance/${user.rollNumber}/waivers/`, {
            signal: controller.signal,
          }),
        ])

        if (attendanceResult.status === 'fulfilled') {
          setRecords(Array.isArray(attendanceResult.value.data) ? attendanceResult.value.data : [])
        } else {
          setRecords([])
          throw attendanceResult.reason
        }

        if (waiverResult.status === 'fulfilled') {
          setWaivers(Array.isArray(waiverResult.value.data) ? waiverResult.value.data : [])
        } else {
          setWaivers([])
        }
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Failed to fetch attendance records.')
        }
      } finally {
        setLoading(false)
      }
    }

    loadAttendance()
    return () => controller.abort()
  }, [user?.rollNumber])

  const sortedRecords = useMemo(() => {
    return records
      .map((record) => {
        const analytics = calculateAttendanceCourseMetrics(record)
        const insights = getAttendanceInsights(record)
        return {
          ...record,
          courseName: normalizeCourseDisplayName(record?.course?.name || record?.course?.code),
          courseCode: record?.course?.code || 'N/A',
          analytics,
          insights,
          chartAttendancePercent: analytics.attendancePercentage,
        }
      })
      .sort((left, right) => {
        if (left.insights.courseCompleted !== right.insights.courseCompleted) {
          return left.insights.courseCompleted ? 1 : -1
        }
        if (left.insights.requiresAttention !== right.insights.requiresAttention) {
          return left.insights.requiresAttention ? -1 : 1
        }
        return left.courseCode.localeCompare(right.courseCode)
      })
  }, [records])

  useEffect(() => {
    if (!waiverForm.courseCode && sortedRecords.length > 0) {
      setWaiverForm((current) => ({
        ...current,
        courseCode: sortedRecords[0].courseCode,
      }))
    }
  }, [sortedRecords, waiverForm.courseCode])

  async function submitWaiver(event) {
    event.preventDefault()
    if (!user?.rollNumber) {
      return
    }

    setWaiverError('')
    setWaiverSuccess('')

    if (!waiverForm.courseCode) {
      setWaiverError('Please choose a course for the waiver request.')
      return
    }
    if (!waiverForm.file) {
      setWaiverError('Please attach a proof file before submitting.')
      return
    }

    setWaiverSubmitting(true)
    try {
      const payload = new FormData()
      payload.append('course_code', waiverForm.courseCode)
      payload.append('reason', waiverForm.reason)
      payload.append('supporting_file', waiverForm.file)

      const response = await api.post(`/api/v1/attendance/${user.rollNumber}/waivers/`, payload, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      setWaivers((current) => [response.data, ...current])
      setWaiverForm((current) => ({
        ...current,
        reason: '',
        file: null,
      }))
      setFileInputKey((current) => current + 1)
      setWaiverSuccess('Proof uploaded successfully. The request is now pending IPMO review.')
    } catch (submitError) {
      setWaiverError(submitError?.response?.data?.detail || 'Unable to upload absence proof right now.')
    } finally {
      setWaiverSubmitting(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Attendance Intelligence</h2>
          <p className="mt-1 text-sm text-slate-500">
            80% attendance is mandatory per course. Every absence beyond the credit limit deducts 0.25 grade points.
          </p>
        </div>
        <a
          href={ATTENDANCE_MASTER_SHEET_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-iim-blue hover:text-iim-blue"
        >
          Open Master Sheet
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loading && sortedRecords.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="heading-tight text-lg font-semibold text-slate-900">Attendance Action Center</h3>
            <p className="text-xs font-medium text-slate-500">Mandate: 80% per course • Max absences = credits</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedRecords.map((record) => {
              const tone = getActionCenterTone(record.insights)
              const ToneIcon = tone.icon

              return (
                <article
                  key={`action-${record.courseCode}`}
                  className={cn('rounded-xl border p-4 shadow-sm transition', tone.container)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {record.courseCode}
                      </p>
                      <p className="mt-1 text-sm font-semibold">{record.courseName}</p>
                    </div>
                    <span className={cn('rounded-full p-2', tone.badge)}>
                      <ToneIcon className="h-4 w-4" />
                    </span>
                  </div>

                  <p className="mt-4 text-sm font-semibold">{tone.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{tone.detail}</p>
                </article>
              )
            })}
          </div>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="heading-tight text-base font-semibold text-slate-900">Attendance % by Course</h3>
                <p className="mt-1 text-xs text-slate-500">Dashed line marks the 80% mandate threshold.</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                On-track
                <span className="ml-1 h-2 w-2 rounded-full bg-rose-500" />
                Below 80%
              </div>
            </div>

            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sortedRecords} margin={{ top: 12, right: 10, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="courseCode"
                    tick={{ fill: '#334155', fontSize: 12 }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={{ stroke: '#cbd5e1' }}
                  />
                  <Tooltip
                    formatter={(value) => `${Number(value || 0).toFixed(2)}%`}
                    labelFormatter={(label) => `Course: ${label}`}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.14)' }}
                  />
                  <ReferenceLine
                    y={80}
                    stroke="#dc2626"
                    strokeDasharray="6 6"
                    ifOverflow="extendDomain"
                    label={{ value: '80%', fill: '#dc2626', position: 'insideTopRight', fontSize: 11 }}
                  />
                  <Bar dataKey="chartAttendancePercent" radius={[8, 8, 0, 0]}>
                    {sortedRecords.map((record) => (
                      <Cell key={`bar-${record.courseCode}`} fill={getChartBarColor(record)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <article className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h3 className="heading-tight text-lg font-semibold text-slate-900">Attendance Rules</h3>
              <p className="mt-1 text-sm text-slate-500">
                Quick guide for course completion and waiver-free absences.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm text-slate-700">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              `1 credit = 5 classes`
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              `2 credits = 10 classes`, `3 credits = 15 classes`, `4 credits = 20 classes`
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              Allowed absences = course credits (80% mandate per course)
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              Penalty after limit = `0.25` grade points per extra absence
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              Course closes when delivered is at least `credits × 5`
            </div>
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-iim-gold">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div>
              <h3 className="heading-tight text-lg font-semibold text-slate-900">Upload Absence Proof</h3>
              <p className="mt-1 text-sm text-slate-500">
                Submit a proof document for IPMO waiver review against a specific course.
              </p>
            </div>
          </div>

          <form onSubmit={submitWaiver} className="mt-5 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Course
                <select
                  value={waiverForm.courseCode}
                  onChange={(event) =>
                    setWaiverForm((current) => ({ ...current, courseCode: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                >
                  {sortedRecords.map((record) => (
                    <option key={record.courseCode} value={record.courseCode}>
                      {record.courseCode} - {record.courseName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Proof File
                <input
                  key={fileInputKey}
                  type="file"
                  onChange={(event) =>
                    setWaiverForm((current) => ({
                      ...current,
                      file: event.target.files?.[0] || null,
                    }))
                  }
                  className="mt-1 block w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-iim-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                />
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Reason / Note
              <textarea
                rows={3}
                value={waiverForm.reason}
                onChange={(event) =>
                  setWaiverForm((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Example: Medical absence on 12 March with prescription attached."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              />
            </label>

            {waiverError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {waiverError}
              </div>
            ) : null}

            {waiverSuccess ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {waiverSuccess}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={waiverSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <FileUp className="h-4 w-4" />
              {waiverSubmitting ? 'Uploading...' : 'Submit Proof'}
            </button>
          </form>
        </article>
      </div>

      {waivers.length > 0 ? (
        <article className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-iim-blue" />
            <h3 className="heading-tight text-lg font-semibold text-slate-900">Submitted Waiver Requests</h3>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {waivers.map((waiver) => (
              <div key={waiver.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{waiver.course?.code || 'Course'}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatSubmittedAt(waiver.submitted_at)}</p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize',
                      waiverStatusTone(waiver.status),
                    )}
                  >
                    {waiver.status}
                  </span>
                </div>

                {waiver.reason ? (
                  <p className="mt-3 text-sm text-slate-700">{waiver.reason}</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No additional note added.</p>
                )}

                {waiver.review_notes ? (
                  <p className="mt-2 text-xs text-slate-500">Review note: {waiver.review_notes}</p>
                ) : null}

                {waiver.file_url ? (
                  <a
                    href={waiver.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-iim-blue hover:text-iim-gold"
                  >
                    Open proof <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && sortedRecords.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-soft">
          No attendance data available for this student yet.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedRecords.map((record, index) => {
          const insights = record.insights
          const attendancePercent =
            insights.totalDelivered > 0
              ? Math.min(100, (insights.totalAttended / insights.totalDelivered) * 100)
              : 0

          return (
            <motion.article
              key={`${record.courseCode}-${index}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.25) }}
              className={cn(
                'rounded-2xl border border-slate-200/80 border-l-4 bg-white p-5 shadow-soft transition duration-200 hover:-translate-y-1 hover:shadow-lg',
                insights.courseCompleted
                  ? 'border-emerald-300 border-l-emerald-500 bg-emerald-50/40'
                  : courseColorClass(record.courseCode),
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {record.courseCode}
                  </p>
                  <h3 className="mt-1 heading-tight text-lg font-semibold text-slate-900">
                    {record.courseName}
                  </h3>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-semibold',
                      percentageTone(Number(record.percentage || 0)),
                    )}
                  >
                    {Number(record.percentage || 0).toFixed(1)}%
                  </span>
                  {insights.courseCompleted ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                      Completed
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Attendance progress</span>
                  <span>
                    {insights.totalAttended}/{insights.totalDelivered} attended
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className={cn('h-2 rounded-full', insights.courseCompleted ? 'bg-emerald-500' : 'bg-iim-blue')}
                    style={{
                      width: `${Math.max(0, Math.min(100, attendancePercent))}%`,
                    }}
                  />
                </div>
              </div>

              {insights.courseCompleted ? (
                <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Complete: delivered {insights.totalDelivered}/{insights.classTarget} classes
                </p>
              ) : insights.inPenaltyZone ? (
                <p className="mt-3 text-xs font-semibold text-rose-600">
                  Penalty active: -{insights.gradePenalty.toFixed(2)} grade points.
                </p>
              ) : insights.atAbsenceLimit ? (
                <p className="mt-3 text-xs font-semibold text-rose-600">
                  No more absences allowed (0 safe skips).
                </p>
              ) : (
                <p className="mt-3 text-xs font-semibold text-slate-600">
                  {insights.safeSkips} safe skips remaining
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Credits: {insights.credits || 'N/A'}
                  {insights.creditsInferred ? ' (auto)' : ''}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Missed: {insights.currentAbsences}/{insights.allowedAbsences || 'N/A'}
                </span>
                <span className="rounded-full bg-iim-blue/10 px-3 py-1 text-xs font-semibold text-iim-blue">
                  Completion target: {insights.classTarget || 'N/A'} classes
                </span>
              </div>

              {record?.course?.drive_link ? (
                <a
                  href={record.course.drive_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-iim-blue hover:text-iim-gold"
                >
                  Open drive material <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}
