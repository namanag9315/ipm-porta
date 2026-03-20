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

function buildWeekDays(weekStartIso) {
  if (!weekStartIso) {
    return []
  }

  const weekStart = new Date(`${weekStartIso}T00:00:00`)
  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)

    return {
      iso: toIsoDate(date),
      day: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(date),
      dayNumber: new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(date),
    }
  })
}

function getSessionState(session, nowMs) {
  const startAt = session._startAt instanceof Date ? session._startAt : combineDateAndTime(session.date, session.start_time)
  const endAt = session._endAt instanceof Date ? session._endAt : combineDateAndTime(session.date, session.end_time)

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return {
      startAt,
      endAt,
      isPast: false,
      isLive: false,
    }
  }

  return {
    startAt,
    endAt,
    isPast: endAt.getTime() < nowMs,
    isLive: startAt.getTime() <= nowMs && endAt.getTime() >= nowMs,
  }
}

export default function TimetableView() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedWeekStart, setSelectedWeekStart] = useState('')
  const [selectedDay, setSelectedDay] = useState('')
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

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
      const endAt = combineDateAndTime(session.date, session.end_time)
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return
      }

      const weekStart = getWeekStartIso(session.date)
      if (!byWeek.has(weekStart)) {
        byWeek.set(weekStart, new Map())
      }

      const byDay = byWeek.get(weekStart)
      if (!byDay.has(session.date)) {
        byDay.set(session.date, [])
      }

      byDay.get(session.date).push({
        ...session,
        _startAt: startAt,
        _endAt: endAt,
      })
    })

    return Array.from(byWeek.entries())
      .sort((left, right) => new Date(`${left[0]}T00:00:00`) - new Date(`${right[0]}T00:00:00`))
      .map(([weekStart, sessionsByDay]) => {
        const normalizedDayMap = new Map()
        sessionsByDay.forEach((daySessions, dateIso) => {
          normalizedDayMap.set(
            dateIso,
            [...daySessions].sort((left, right) => left._startAt.getTime() - right._startAt.getTime()),
          )
        })

        return {
          weekStart,
          label: getWeekLabel(weekStart),
          sessionsByDay: normalizedDayMap,
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

      return weekBuckets[0].weekStart
    })
  }, [weekBuckets])

  useEffect(() => {
    if (!selectedWeekStart) {
      setSelectedDay('')
      return
    }

    const weekStart = new Date(`${selectedWeekStart}T00:00:00`)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const shouldUseToday = today.getTime() >= weekStart.getTime() && today.getTime() <= weekEnd.getTime()
    setSelectedDay(shouldUseToday ? toIsoDate(today) : selectedWeekStart)
  }, [selectedWeekStart])

  const selectedBucket = useMemo(
    () => weekBuckets.find((bucket) => bucket.weekStart === selectedWeekStart) || null,
    [weekBuckets, selectedWeekStart],
  )

  const weekDays = useMemo(() => buildWeekDays(selectedWeekStart), [selectedWeekStart])

  const selectedDaySessions = useMemo(() => {
    if (!selectedBucket || !selectedDay) {
      return []
    }
    return selectedBucket.sessionsByDay.get(selectedDay) || []
  }, [selectedBucket, selectedDay])

  return (
    <section className="space-y-5">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="heading-tight text-2xl font-bold text-slate-900">Timetable Timeline</h2>
            <p className="mt-1 text-sm text-slate-500">
              Interactive day planner for your current week schedule.
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
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
            >
              {weekBuckets.length === 0 ? <option value="">No weeks available</option> : null}
              {weekBuckets.map((bucket) => (
                <option key={bucket.weekStart} value={bucket.weekStart}>
                  {bucket.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
          <div className="inline-flex min-w-full items-center gap-2 rounded-2xl bg-slate-100/80 p-2">
            {weekDays.map((day) => {
              const isActive = day.iso === selectedDay
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedDay(day.iso)}
                  className={cn(
                    'min-w-[92px] rounded-xl px-3 py-2 text-left transition',
                    isActive
                      ? 'bg-blue-800 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide">{day.day}</p>
                  <p className="mt-0.5 text-sm font-semibold">{day.dayNumber}</p>
                </button>
              )
            })}
          </div>
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
            <div key={index} className="h-36 animate-pulse rounded-2xl bg-white shadow-[0_4px_24px_rgb(0,0,0,0.04)]" />
          ))}
        </div>
      ) : null}

      {!loading && selectedWeekStart && (
        <motion.section
          key={selectedDay || selectedWeekStart}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="rounded-2xl bg-slate-50/90 p-4"
        >
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-iim-blue" />
            <h3 className="text-lg font-bold text-slate-800">
              {selectedDay ? formatDayTitle(`${selectedDay}T00:00:00`) : 'Select a day'}
            </h3>
          </div>

          {selectedDaySessions.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-[0_4px_24px_rgb(0,0,0,0.04)]">
              No classes scheduled for this day.
            </div>
          ) : (
            <div className="relative pl-10">
              <div className="absolute bottom-3 left-3 top-3 border-l-2 border-slate-200" />

              <div className="space-y-4">
                {selectedDaySessions.map((session, index) => {
                  const state = getSessionState(session, nowMs)

                  return (
                    <motion.article
                      key={session.id || `${session.date}-${session.start_time}-${index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.18) }}
                      className={cn(
                        'relative rounded-2xl bg-white p-5 shadow-[0_4px_24px_rgb(0,0,0,0.04)]',
                        state.isPast && 'opacity-60',
                        session.is_exam && 'border-l-4 border-yellow-400 bg-yellow-50',
                      )}
                    >
                      <span className="absolute -left-9 top-8 flex h-4 w-4 items-center justify-center">
                        {state.isLive ? (
                          <span className="absolute h-4 w-4 rounded-full bg-blue-400/40 animate-ping" />
                        ) : null}
                        <span
                          className={cn(
                            'relative h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm',
                            session.is_exam ? 'bg-yellow-500' : state.isLive ? 'bg-blue-700' : 'bg-slate-400',
                          )}
                        />
                      </span>

                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{getSessionTitle(session)}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {session.is_exam ? 'Exam' : session.course?.code || 'General'}
                          </p>
                        </div>

                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatTimeLabel(state.startAt)} - {formatTimeLabel(state.endAt)}
                        </div>
                      </div>

                      <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        {session.room || 'Room not specified'}
                      </p>
                    </motion.article>
                  )
                })}
              </div>
            </div>
          )}
        </motion.section>
      )}

      {!loading && weekBuckets.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          No timetable sessions found yet.
        </div>
      ) : null}
    </section>
  )
}
