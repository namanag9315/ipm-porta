import { motion } from 'framer-motion'
import { CalendarClock, Clock3, ExternalLink, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'
import { combineDateAndTime, formatDayTitle, formatTimeLabel, startOfWeek, toIsoDate } from '../lib/date'

const TIMETABLE_MASTER_SHEET_URL =
  import.meta.env.VITE_TIMETABLE_MASTER_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/1dnzXBXlF4-OpVblhj4DJM6kJ5l-FEACjWwun7ntTGXk/edit'

function isToday(dateString) {
  const today = new Date()
  const target = new Date(`${dateString}T00:00:00`)
  return (
    today.getFullYear() === target.getFullYear() &&
    today.getMonth() === target.getMonth() &&
    today.getDate() === target.getDate()
  )
}

function getSessionTitle(session) {
  if (session?.is_exam) {
    return session?.raw_text || session?.course?.name || 'Exam'
  }
  return session?.raw_text || session?.course?.name || 'Session'
}

function getWeekStartIso(dateIso) {
  const date = new Date(`${dateIso}T00:00:00`)
  return toIsoDate(startOfWeek(date))
}

function getWeekLabel(weekStartIso) {
  const startDate = new Date(`${weekStartIso}T00:00:00`)
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 6)

  const formatter = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  })

  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`
}

export default function TimetableView() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedWeekStart, setSelectedWeekStart] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadTimetable() {
      if (!user?.rollNumber) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const response = await api.get(`/api/v1/timetable/${user.rollNumber}/`, {
          signal: controller.signal,
        })
        setSessions(Array.isArray(response.data) ? response.data : [])
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Failed to load timetable data.')
        }
      } finally {
        setLoading(false)
      }
    }

    loadTimetable()
    return () => controller.abort()
  }, [user?.rollNumber])

  const weekBuckets = useMemo(() => {
    const byWeek = new Map()

    sessions.forEach((session) => {
      const startAt = combineDateAndTime(session.date, session.start_time)
      if (Number.isNaN(startAt.getTime())) {
        return
      }

      const weekStart = getWeekStartIso(session.date)
      if (!byWeek.has(weekStart)) {
        byWeek.set(weekStart, [])
      }
      byWeek.get(weekStart).push(session)
    })

    return Array.from(byWeek.entries())
      .sort((left, right) => new Date(left[0]) - new Date(right[0]))
      .map(([weekStart, weekSessions]) => {
        const byDay = new Map()
        weekSessions.forEach((session) => {
          if (!byDay.has(session.date)) {
            byDay.set(session.date, [])
          }
          byDay.get(session.date).push(session)
        })

        const days = Array.from(byDay.entries())
          .sort((left, right) => new Date(left[0]) - new Date(right[0]))
          .map(([date, daySessions]) => ({
            date,
            sessions: [...daySessions].sort(
              (left, right) =>
                combineDateAndTime(left.date, left.start_time) -
                combineDateAndTime(right.date, right.start_time),
            ),
          }))

        return {
          weekStart,
          label: getWeekLabel(weekStart),
          days,
        }
      })
  }, [sessions])

  useEffect(() => {
    setSelectedWeekStart((current) => {
      if (current && weekBuckets.some((bucket) => bucket.weekStart === current)) {
        return current
      }

      if (weekBuckets.length === 0) {
        return ''
      }

      const currentWeekStart = toIsoDate(startOfWeek(new Date()))
      if (weekBuckets.some((bucket) => bucket.weekStart === currentWeekStart)) {
        return currentWeekStart
      }

      const firstFuture = weekBuckets.find(
        (bucket) =>
          new Date(`${bucket.weekStart}T00:00:00`).getTime() >
          new Date(`${currentWeekStart}T00:00:00`).getTime(),
      )

      return firstFuture?.weekStart || weekBuckets[0].weekStart
    })
  }, [weekBuckets])

  const grouped = useMemo(() => {
    const selectedBucket = weekBuckets.find((bucket) => bucket.weekStart === selectedWeekStart)
    return selectedBucket?.days || []
  }, [weekBuckets, selectedWeekStart])

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Timetable Timeline</h2>
          <p className="mt-1 text-sm text-slate-500">
            A daily schedule view tailored to your registered courses and section.
          </p>
        </div>

        <div className="w-full max-w-xs space-y-2">
          <a
            href={TIMETABLE_MASTER_SHEET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-iim-blue hover:text-iim-blue"
          >
            Open Master Sheet
            <ExternalLink className="h-4 w-4" />
          </a>
          <label
            htmlFor="week-select"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Week
          </label>
          <select
            id="week-select"
            value={selectedWeekStart}
            onChange={(event) => setSelectedWeekStart(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-soft focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
          >
            {weekBuckets.length === 0 ? (
              <option value="">No weeks available</option>
            ) : null}
            {weekBuckets.map((bucket) => (
              <option key={bucket.weekStart} value={bucket.weekStart}>
                {bucket.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-2xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-soft">
          No timetable sessions found yet.
        </div>
      ) : null}

      <div className="space-y-4">
        {grouped.map((group, groupIndex) => {
          const currentDay = isToday(group.date)
          return (
            <motion.article
              key={group.date}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(groupIndex * 0.04, 0.2) }}
              className={cn(
                'rounded-3xl border bg-white p-5 shadow-soft',
                currentDay
                  ? 'border-iim-blue/40 ring-2 ring-iim-blue/10'
                  : 'border-slate-200/80',
              )}
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock className={cn('h-5 w-5', currentDay ? 'text-iim-blue' : 'text-slate-500')} />
                  <h3 className="heading-tight text-lg font-semibold text-slate-900">
                    {formatDayTitle(`${group.date}T00:00:00`)}
                  </h3>
                </div>
                {currentDay ? (
                  <span className="rounded-full bg-iim-blue/10 px-3 py-1 text-xs font-semibold text-iim-blue">
                    Today
                  </span>
                ) : null}
              </div>

              <div className="relative space-y-4 pl-8">
                <div className="absolute bottom-4 left-3 top-2 w-px bg-slate-200" />

                {group.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      'relative rounded-2xl border p-4',
                      session.is_exam
                        ? 'border-amber-300/80 bg-amber-50/70'
                        : 'border-slate-200/70 bg-slate-50/80',
                    )}
                  >
                    <span className="absolute -left-[1.37rem] top-6 h-3 w-3 rounded-full border-2 border-white bg-iim-blue" />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="heading-tight text-base font-semibold text-slate-900">
                          {getSessionTitle(session)}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {session.is_exam ? 'Exam' : session.course?.code || 'General'}
                        </p>
                      </div>

                      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatTimeLabel(`${session.date}T${session.start_time}`)} -{' '}
                        {formatTimeLabel(`${session.date}T${session.end_time}`)}
                      </div>
                    </div>

                    <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      {session.room}
                    </p>
                  </div>
                ))}
              </div>
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}
