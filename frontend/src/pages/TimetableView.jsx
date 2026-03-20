import { motion } from 'framer-motion'
import { CalendarClock, Clock3, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'
import { combineDateAndTime, formatDayTitle, formatTimeLabel, startOfWeek, toIsoDate } from '../lib/date'

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
  const startAt =
    session._startAt instanceof Date ? session._startAt : combineDateAndTime(session.date, session.start_time)
  const endAt =
    session._endAt instanceof Date ? session._endAt : combineDateAndTime(session.date, session.end_time)

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

function getDurationMinutes(startAt, endAt) {
  const deltaMs = endAt.getTime() - startAt.getTime()
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 0
  }
  return Math.round(deltaMs / (1000 * 60))
}

const BADGE_BASE_CLASS =
  "inline-flex items-center rounded-[5px] px-[7px] py-[2px] text-[9.5px] font-semibold uppercase tracking-[0.8px] [font-family:'DM Sans',sans-serif]"

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

  const selectedWeekIndex = useMemo(
    () => weekBuckets.findIndex((bucket) => bucket.weekStart === selectedWeekStart),
    [weekBuckets, selectedWeekStart],
  )

  const selectedBucket = useMemo(
    () => (selectedWeekIndex >= 0 ? weekBuckets[selectedWeekIndex] : null),
    [selectedWeekIndex, weekBuckets],
  )

  const weekDays = useMemo(() => {
    const baseDays = buildWeekDays(selectedWeekStart)
    const sessionsByDay = selectedBucket?.sessionsByDay

    return baseDays.map((day) => {
      const classCount = sessionsByDay?.get(day.iso)?.length || 0
      return {
        ...day,
        classCount,
      }
    })
  }, [selectedWeekStart, selectedBucket])

  const selectedDaySessions = useMemo(() => {
    if (!selectedBucket || !selectedDay) {
      return []
    }
    return selectedBucket.sessionsByDay.get(selectedDay) || []
  }, [selectedBucket, selectedDay])

  const canGoPrevWeek = selectedWeekIndex > 0
  const canGoNextWeek = selectedWeekIndex >= 0 && selectedWeekIndex < weekBuckets.length - 1

  function goToPrevWeek() {
    if (!canGoPrevWeek) {
      return
    }
    setSelectedWeekStart(weekBuckets[selectedWeekIndex - 1].weekStart)
  }

  function goToNextWeek() {
    if (!canGoNextWeek) {
      return
    }
    setSelectedWeekStart(weekBuckets[selectedWeekIndex + 1].weekStart)
  }

  return (
    <section className="space-y-5 rounded-2xl bg-[#f5f4f1] p-4 sm:p-5">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-[-0.6px] text-[#0f1e3d] [font-family:'Syne',sans-serif]">
              Timetable
            </h2>
            <p className="mt-1 text-[12px] text-[#aaa] [font-family:'DM Sans',sans-serif]">
              Interactive week planner
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-[8px] bg-white px-[12px] py-[7px] [border:0.5px_solid_rgba(0,0,0,0.1)]">
            <button
              type="button"
              onClick={goToPrevWeek}
              disabled={!canGoPrevWeek}
              className="text-[12px] text-slate-700 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous week"
            >
              ←
            </button>
            <span className="text-[12px] text-slate-700 [font-family:'DM Mono',monospace]">
              {selectedBucket?.label || 'No weeks available'}
            </span>
            <button
              type="button"
              onClick={goToNextWeek}
              disabled={!canGoNextWeek}
              className="text-[12px] text-slate-700 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next week"
            >
              →
            </button>
          </div>
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
          <div className="inline-flex min-w-full items-center gap-2">
            {weekDays.map((day) => {
              const isActive = day.iso === selectedDay
              const hasClasses = day.classCount > 0
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedDay(day.iso)}
                  className={cn(
                    'min-w-[78px] rounded-[10px] px-3 py-2 text-center transition',
                    isActive
                      ? 'bg-[#0f1e3d] text-white'
                      : hasClasses
                      ? 'bg-white [border:0.5px_solid_rgba(0,0,0,0.07)] hover:bg-slate-50 text-slate-700'
                      : 'text-[#ccc] hover:bg-transparent',
                  )}
                >
                  <p className="text-[10px] uppercase tracking-[1px] [font-family:'DM Sans',sans-serif]">
                    {day.day}
                  </p>
                  <p className="mt-0.5 text-[17px] font-bold [font-family:'Syne',sans-serif]">{day.dayNumber}</p>

                  <div className="mt-1.5 flex items-center justify-center gap-1">
                    {Array.from({ length: Math.min(3, day.classCount) }).map((_, index) => (
                      <span
                        key={`${day.iso}-dot-${index}`}
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          isActive ? 'bg-[rgba(255,255,255,0.5)]' : 'bg-[rgba(99,130,255,0.6)]',
                        )}
                      />
                    ))}
                  </div>
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
            <div
              key={index}
              className="h-28 animate-pulse rounded-[12px] bg-white shadow-[0_4px_24px_rgb(0,0,0,0.04)]"
            />
          ))}
        </div>
      ) : null}

      {!loading && selectedWeekStart && (
        <motion.section
          key={selectedDay || selectedWeekStart}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="rounded-[12px] bg-[#f5f4f1]"
        >
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[#7a8bb8]" />
            <h3 className="text-[13px] font-medium text-slate-600 [font-family:'DM Sans',sans-serif]">
              {selectedDay ? formatDayTitle(`${selectedDay}T00:00:00`) : 'Select a day'}
            </h3>
          </div>

          {selectedDaySessions.length === 0 ? (
            <div className="rounded-[12px] bg-white p-6 text-sm text-slate-500 shadow-[0_4px_24px_rgb(0,0,0,0.04)] [font-family:'DM Sans',sans-serif]">
              No classes scheduled for this day.
            </div>
          ) : (
            <div className="space-y-[10px]">
              {selectedDaySessions.map((session, index) => {
                const state = getSessionState(session, nowMs)
                const durationMinutes = getDurationMinutes(state.startAt, state.endAt)
                const isLast = index === selectedDaySessions.length - 1

                return (
                  <motion.div
                    key={session.id || `${session.date}-${session.start_time}-${index}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.18) }}
                    className={cn('flex gap-3', state.isPast && 'opacity-60')}
                  >
                    <div className="relative w-[42px] shrink-0 pt-1">
                      <p className="text-[10px] text-[#aaa] [font-family:'DM Mono',monospace]">
                        {formatTimeLabel(state.startAt)}
                      </p>
                      <span
                        className={cn(
                          'absolute left-[16px] top-5 h-2.5 w-2.5 rounded-full bg-[rgba(99,130,255,0.6)]',
                          state.isLive && 'bg-[#1d9e75]',
                          session.is_exam && 'bg-[#ef9f27]',
                        )}
                      />
                      {state.isLive ? (
                        <span className="absolute left-[14px] top-[18px] h-[10px] w-[10px] rounded-full bg-[#6382ff]/30 animate-ping" />
                      ) : null}
                      {!isLast ? (
                        <span className="absolute left-[20px] top-8 bottom-[-18px] w-[1.5px] bg-[rgba(0,0,0,0.08)]" />
                      ) : null}
                    </div>

                    <article
                      className={cn(
                        'flex-1 rounded-[12px] bg-white p-4 shadow-[0_4px_24px_rgb(0,0,0,0.04)]',
                        session.is_exam && 'border-l-[3px] border-[#ef9f27] bg-[#fffbf0]',
                        !session.is_exam && state.isLive && 'border-l-[3px] border-[#1d9e75] bg-[#f4fdf8]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            {session.is_exam ? (
                              <span className={cn(BADGE_BASE_CLASS, 'bg-[#faeeda] text-[#854f0b]')}>EXAM</span>
                            ) : state.isLive ? (
                              <>
                                <span className={cn(BADGE_BASE_CLASS, 'bg-[#e1f5ee] text-[#0f6e56]')}>NOW</span>
                                <span className={cn(BADGE_BASE_CLASS, 'bg-[#e6f1fb] text-[#185fa5]')}>LECTURE</span>
                              </>
                            ) : (
                              <span className={cn(BADGE_BASE_CLASS, 'bg-[#e6f1fb] text-[#185fa5]')}>LECTURE</span>
                            )}
                          </div>

                          <p className="text-[13.5px] font-bold text-[#0f1e3d] [font-family:'Syne',sans-serif]">
                            {getSessionTitle(session)}
                          </p>

                          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 [font-family:'DM Sans',sans-serif]">
                            <MapPin className="h-[11px] w-[11px] text-[#bbb]" />
                            {session.room || 'Room not specified'}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-[11px] text-[#888] [font-family:'DM Mono',monospace]">
                            {formatTimeLabel(state.startAt)} - {formatTimeLabel(state.endAt)}
                          </p>
                          <p className="mt-1 text-[10px] text-[#bbb] [font-family:'DM Mono',monospace]">
                            {durationMinutes > 0 ? `${durationMinutes} min` : '--'}
                          </p>
                        </div>
                      </div>
                    </article>
                  </motion.div>
                )
              })}
            </div>
          )}
        </motion.section>
      )}

      {!loading && weekBuckets.length === 0 ? (
        <div className="rounded-[12px] bg-white p-6 text-sm text-slate-500 shadow-[0_4px_24px_rgb(0,0,0,0.04)] [font-family:'DM Sans',sans-serif]">
          No timetable sessions found yet.
        </div>
      ) : null}
    </section>
  )
}
