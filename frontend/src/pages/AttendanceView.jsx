import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
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

function safeToMiss(totalAttended, totalDelivered, threshold = 0.75) {
  const attended = Number(totalAttended || 0)
  const delivered = Number(totalDelivered || 0)

  if (!Number.isFinite(attended) || !Number.isFinite(delivered)) {
    return 0
  }

  const maxMissed = Math.floor(attended / threshold - delivered)
  return Math.max(0, maxMissed)
}

function percentageTone(percentage) {
  if (percentage >= 85) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (percentage >= 75) {
    return 'bg-amber-100 text-amber-700'
  }
  return 'bg-rose-100 text-rose-700'
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

export default function AttendanceView() {
  const { user } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
        const response = await api.get(`/api/v1/attendance/${user.rollNumber}/`, {
          signal: controller.signal,
        })
        setRecords(Array.isArray(response.data) ? response.data : [])
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

  const sortedRecords = useMemo(
    () => [...records].sort((left, right) => right.percentage - left.percentage),
    [records],
  )

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Attendance Intelligence</h2>
          <p className="mt-1 text-sm text-slate-500">
            Live attendance by subject, including safe-to-bunk analysis at 75% threshold.
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
          const courseName = normalizeCourseDisplayName(record?.course?.name || record?.course?.code)
          const courseCode = record?.course?.code || 'N/A'
          const safeMissCount = safeToMiss(record.total_attended, record.total_delivered)

          return (
            <motion.article
              key={`${courseCode}-${index}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.25) }}
              className={cn(
                'rounded-2xl border border-slate-200/80 border-l-4 bg-white p-5 shadow-soft transition duration-200 hover:-translate-y-1 hover:shadow-lg',
                courseColorClass(courseCode),
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {courseCode}
                  </p>
                  <h3 className="mt-1 heading-tight text-lg font-semibold text-slate-900">{courseName}</h3>
                </div>
                <span
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold',
                    percentageTone(Number(record.percentage || 0)),
                  )}
                >
                  {Number(record.percentage || 0).toFixed(1)}%
                </span>
              </div>

              <div className="mt-4 h-2 rounded-full bg-slate-100">
                <div
                  className={cn(
                    'h-2 rounded-full',
                    Number(record.percentage || 0) >= 85
                      ? 'bg-emerald-500'
                      : Number(record.percentage || 0) >= 75
                        ? 'bg-amber-500'
                        : 'bg-rose-500',
                  )}
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(record.percentage || 0)))}%`,
                  }}
                />
              </div>
              {Number(record.percentage || 0) < 75 ? (
                <p className="mt-2 text-xs font-semibold text-rose-600">
                  Important: Attend upcoming classes
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Attended: {record.total_attended}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Delivered: {record.total_delivered}
                </span>
                <span className="rounded-full bg-iim-blue/10 px-3 py-1 text-xs font-semibold text-iim-blue">
                  Safe to miss: {safeMissCount} classes
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
