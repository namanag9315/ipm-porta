import { motion } from 'framer-motion'
import {
  ArrowRight,
  BellRing,
  BookOpenText,
  Cake,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ClipboardCheck,
  UtensilsCrossed,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'
import { combineDateAndTime, formatDateLabel, formatTimeLabel, toIsoDate } from '../lib/date'

const MAX_DASHBOARD_CLASSES = 3
const DASHBOARD_PRIMARY_TIMEOUT_MS = 15000
const DASHBOARD_SECONDARY_TIMEOUT_MS = 9000
const COURSE_COLOR_CLASSES = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-orange-500',
]
const DASHBOARD_CARD_CLASS =
  'rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.04)]'
const DASHBOARD_CARD_TITLE_CLASS = 'text-lg font-bold text-slate-800'
const DASHBOARD_CARD_SUBTEXT_CLASS = 'text-sm text-slate-500'

const MEAL_SLOTS = [
  {
    key: 'breakfast',
    label: 'Breakfast',
    startHour: 7,
    startMinute: 30,
    endHour: 10,
    endMinute: 30,
    patterns: ['breakfast'],
  },
  {
    key: 'lunch',
    label: 'Lunch',
    startHour: 12,
    startMinute: 30,
    endHour: 15,
    endMinute: 0,
    patterns: ['lunch'],
  },
  {
    key: 'snacks',
    label: 'Snacks / High Tea',
    startHour: 16,
    startMinute: 30,
    endHour: 18,
    endMinute: 30,
    patterns: ['snacks', 'high tea', 'hi tea'],
  },
  {
    key: 'dinner',
    label: 'Dinner',
    startHour: 19,
    startMinute: 30,
    endHour: 21,
    endMinute: 30,
    patterns: ['dinner'],
  },
]

const HOT_BREAKFAST_WIDGET_HINTS = [
  'hot',
  'preparation',
  'egg',
  'omelette',
  'poha',
  'upma',
  'paratha',
  'idli',
  'dosa',
  'uttapam',
  'cutlet',
  'sandwich',
]

function getCountdown(targetDate) {
  if (!targetDate) {
    return 'No upcoming class'
  }

  const difference = targetDate.getTime() - Date.now()
  if (difference <= 0) {
    return 'Starting now'
  }

  const totalSeconds = Math.floor(difference / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  return `${minutes}m ${seconds}s`
}

function getMealSlot(category) {
  const normalized = String(category || '').toLowerCase()
  return MEAL_SLOTS.find((slot) =>
    slot.patterns.some((pattern) => normalized.includes(pattern)),
  )
}

function createDateWithTime(dateIso, hour, minute) {
  return new Date(
    `${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  )
}

function prioritizeMealItemsForWidget(label, items) {
  const uniqueItems = [...new Set(items || [])]
  if (!String(label || '').toLowerCase().includes('breakfast')) {
    return uniqueItems
  }
  return uniqueItems.sort((left, right) => {
    const leftText = String(left || '').toLowerCase()
    const rightText = String(right || '').toLowerCase()
    const leftRank = HOT_BREAKFAST_WIDGET_HINTS.some((hint) => leftText.includes(hint)) ? 0 : 1
    const rightRank = HOT_BREAKFAST_WIDGET_HINTS.some((hint) => rightText.includes(hint)) ? 0 : 1
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    return leftText.localeCompare(rightText)
  })
}

function getAssignmentDeadlineMeta(assignment, nowEpoch) {
  const dueAt = assignment?.due_at
    ? new Date(assignment.due_at)
    : new Date(`${assignment?.due_date}T${assignment?.due_time || '23:59:00'}`)
  const delta = dueAt.getTime() - nowEpoch
  const totalHours = Math.floor(delta / (1000 * 60 * 60))
  const totalDays = Math.floor(delta / (1000 * 60 * 60 * 24))

  if (delta < 0) {
    return {
      text: 'Deadline passed',
      classes: 'bg-slate-100 text-slate-600',
    }
  }
  if (delta < 24 * 60 * 60 * 1000) {
    return {
      text: `${Math.max(0, totalHours)}h left`,
      classes: 'bg-rose-50 text-rose-700 font-bold',
    }
  }
  if (delta <= 3 * 24 * 60 * 60 * 1000) {
    return {
      text: `${Math.max(1, totalDays)}d left`,
      classes: 'bg-amber-50 text-amber-700',
    }
  }
  return {
    text: `${Math.max(1, totalDays)}d left`,
    classes: 'bg-slate-50 text-slate-700',
  }
}

function courseColorClass(courseCode) {
  const normalized = String(courseCode || 'NA')
  const hash = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return COURSE_COLOR_CLASSES[hash % COURSE_COLOR_CLASSES.length]
}

function sessionColorClass(session) {
  return courseColorClass(session?.course?.code || session?.raw_text || session?.id || 'SESSION')
}

function getAttendanceHealth(percentage) {
  const value = Number(percentage || 0)
  if (value >= 90) {
    return {
      barClass: 'bg-emerald-500',
      textClass: 'text-emerald-600',
      badgeClass: 'bg-emerald-50 text-emerald-700',
      label: 'Excellent',
    }
  }
  if (value >= 85) {
    return {
      barClass: 'bg-lime-500',
      textClass: 'text-lime-600',
      badgeClass: 'bg-lime-50 text-lime-700',
      label: 'Strong',
    }
  }
  if (value >= 80) {
    return {
      barClass: 'bg-amber-500',
      textClass: 'text-amber-600',
      badgeClass: 'bg-amber-50 text-amber-700',
      label: 'Stable',
    }
  }
  if (value >= 75) {
    return {
      barClass: 'bg-orange-500',
      textClass: 'text-orange-600',
      badgeClass: 'bg-orange-50 text-orange-700',
      label: 'Watch',
    }
  }
  return {
    barClass: 'bg-rose-500',
    textClass: 'text-rose-600',
    badgeClass: 'bg-rose-50 text-rose-700',
    label: 'Critical',
  }
}

function normalizeCourseDisplayName(value) {
  const cleaned = String(value || '')
    .replace(/\bsection\s*[AB]\b/gi, '')
    .replace(/\s+\b[AB]\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Course'
}

const PRIMARY_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

async function getWithRetry(url, { signal, timeoutMs }) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await api.get(url, {
        signal,
        timeout: attempt === 0 ? timeoutMs : timeoutMs * 2,
      })
    } catch (error) {
      if (error?.name === 'CanceledError') {
        throw error
      }
      lastError = error
      const status = error?.response?.status
      const retryable = !error?.response || PRIMARY_RETRYABLE_STATUSES.has(status)
      if (!retryable || attempt === 1) {
        throw error
      }
      await sleep(450)
    }
  }
  throw lastError
}

function buildDashboardPollAnnouncement(polls) {
  const activePolls = Array.isArray(polls) ? polls : []
  if (activePolls.length === 0) {
    return null
  }

  const pendingPolls = activePolls.filter((poll) => !poll?.has_voted)
  const focusPolls = pendingPolls.length > 0 ? pendingPolls : activePolls
  const newestPoll = [...focusPolls].sort(
    (left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime(),
  )[0]
  const highlightedTitles = focusPolls
    .map((poll) => String(poll?.title || '').trim())
    .filter(Boolean)
    .slice(0, 2)
  const extraCount = Math.max(0, focusPolls.length - highlightedTitles.length)
  const title = pendingPolls.length > 0 ? `New poll${pendingPolls.length > 1 ? 's' : ''} available` : 'Polls updated'
  const summaryText = highlightedTitles.length > 0 ? highlightedTitles.join(' • ') : 'Open Polls to check updates'
  const suffixText = extraCount > 0 ? ` • +${extraCount} more` : ''
  const actionText = pendingPolls.length > 0 ? 'Vote now from the Polls section.' : 'Check the latest results in Polls.'

  return {
    id: `poll-alert-${newestPoll?.id || 'active'}`,
    title,
    content: `${summaryText}${suffixText}. ${actionText}`,
    posted_by: 'IPM Portal',
    created_at: newestPoll?.created_at || new Date().toISOString(),
    _is_poll_alert: true,
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  const [attendance, setAttendance] = useState([])
  const [sessions, setSessions] = useState([])
  const [messItems, setMessItems] = useState([])
  const [birthdaysToday, setBirthdaysToday] = useState([])
  const [recentAnnouncements, setRecentAnnouncements] = useState([])
  const [upcomingAssignments, setUpcomingAssignments] = useState([])
  const [readingsSummary, setReadingsSummary] = useState({
    totalMaterials: 0,
    latestMaterialAt: '',
    latestCourseCode: '',
  })
  const [expandedAssignments, setExpandedAssignments] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchDashboardData() {
      if (!user?.rollNumber) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const menuDates = Array.from({ length: 2 }).map((_, index) => {
          const date = new Date()
          date.setDate(date.getDate() + index)
          return toIsoDate(date)
        })

        const [attendanceResult, timetableResult] = await Promise.allSettled([
          getWithRetry(`/api/v1/attendance/${user.rollNumber}/`, {
            signal: controller.signal,
            timeoutMs: DASHBOARD_PRIMARY_TIMEOUT_MS,
          }),
          getWithRetry(`/api/v1/timetable/${user.rollNumber}/`, {
            signal: controller.signal,
            timeoutMs: DASHBOARD_PRIMARY_TIMEOUT_MS,
          }),
        ])
        if (controller.signal.aborted) {
          return
        }

        const attendanceRes = attendanceResult.status === 'fulfilled' ? attendanceResult.value : null
        const timetableRes = timetableResult.status === 'fulfilled' ? timetableResult.value : null

        if (attendanceRes) {
          setAttendance(Array.isArray(attendanceRes.data) ? attendanceRes.data : [])
        } else {
          setAttendance([])
        }

        if (timetableRes) {
          setSessions(Array.isArray(timetableRes.data) ? timetableRes.data : [])
        } else {
          setSessions([])
        }

        const primaryFailures = []
        if (!attendanceRes) {
          const status = attendanceResult.status === 'rejected' ? attendanceResult.reason?.response?.status : ''
          primaryFailures.push(`attendance${status ? ` (${status})` : ''}`)
        }
        if (!timetableRes) {
          const status = timetableResult.status === 'rejected' ? timetableResult.reason?.response?.status : ''
          primaryFailures.push(`timetable${status ? ` (${status})` : ''}`)
        }

        if (primaryFailures.length === 2) {
          setError('Unable to load core dashboard data right now. Please try again in a moment.')
        } else if (primaryFailures.length === 1) {
          setError(`Some core dashboard data is delayed: ${primaryFailures[0]}.`)
        }
        setLoading(false)

        const secondaryResults = await Promise.allSettled([
          api.get('/api/v1/dashboard-extras/', {
            signal: controller.signal,
            timeout: DASHBOARD_SECONDARY_TIMEOUT_MS,
          }),
          user?.rollNumber
            ? api.get(`/api/v1/polls/?roll_number=${user.rollNumber}`, {
                signal: controller.signal,
                timeout: DASHBOARD_SECONDARY_TIMEOUT_MS,
              })
            : Promise.resolve({ data: [] }),
          user?.rollNumber
            ? api.get(`/api/v1/readings/${user.rollNumber}/`, {
                signal: controller.signal,
                timeout: DASHBOARD_SECONDARY_TIMEOUT_MS,
              })
            : Promise.resolve({ data: [] }),
          ...menuDates.map((dateIso) =>
            api.get(`/api/v1/mess-menu/?date=${dateIso}&template_fallback=1`, {
              signal: controller.signal,
              timeout: DASHBOARD_SECONDARY_TIMEOUT_MS,
            }),
          ),
        ])
        if (controller.signal.aborted) {
          return
        }

        const extrasRes = secondaryResults[0]?.status === 'fulfilled' ? secondaryResults[0].value : null
        const pollsRes = secondaryResults[1]?.status === 'fulfilled' ? secondaryResults[1].value : null
        const readingsRes = secondaryResults[2]?.status === 'fulfilled' ? secondaryResults[2].value : null
        const menuResponses = secondaryResults.slice(3)

        if (extrasRes) {
          const rawAnnouncements = Array.isArray(extrasRes.data?.recent_announcements)
            ? extrasRes.data.recent_announcements
            : []
          const activePolls = Array.isArray(pollsRes?.data) ? pollsRes.data : []
          const pollAnnouncement = buildDashboardPollAnnouncement(activePolls)
          setBirthdaysToday(Array.isArray(extrasRes.data?.birthdays_today) ? extrasRes.data.birthdays_today : [])
          setRecentAnnouncements(pollAnnouncement ? [pollAnnouncement, ...rawAnnouncements].slice(0, 4) : rawAnnouncements)
          setUpcomingAssignments(
            Array.isArray(extrasRes.data?.upcoming_assignments) ? extrasRes.data.upcoming_assignments : [],
          )
        } else {
          setBirthdaysToday([])
          setRecentAnnouncements([])
          setUpcomingAssignments([])
        }

        if (readingsRes) {
          const readingCourses = Array.isArray(readingsRes.data) ? readingsRes.data : []
          const flattenedMaterials = readingCourses.flatMap((course) => {
            const materials = Array.isArray(course?.materials) ? course.materials : []
            return materials.map((material) => ({
              ...material,
              _courseCode: course?.code || '',
            }))
          })

          const latestMaterial = flattenedMaterials.reduce((latest, material) => {
            const materialDate = new Date(material?.updated_at || material?.created_at || 0).getTime()
            const latestDate = new Date(latest?.updated_at || latest?.created_at || 0).getTime()
            return materialDate > latestDate ? material : latest
          }, null)

          setReadingsSummary({
            totalMaterials: flattenedMaterials.length,
            latestMaterialAt: latestMaterial?.updated_at || latestMaterial?.created_at || '',
            latestCourseCode: String(latestMaterial?._courseCode || '').toUpperCase(),
          })
        } else {
          setReadingsSummary({
            totalMaterials: 0,
            latestMaterialAt: '',
            latestCourseCode: '',
          })
        }

        const flattenedMenus = menuResponses.flatMap((result, index) => {
          if (result.status !== 'fulfilled') {
            return []
          }
          const items = Array.isArray(result.value.data) ? result.value.data : []
          const dateIso = menuDates[index]
          return items.map((item) => ({
            ...item,
            date: item?.date || dateIso,
          }))
        })
        setMessItems(flattenedMenus)
        const hadSecondaryFailures = secondaryResults.some((result) => result.status === 'rejected')
        if (hadSecondaryFailures) {
          setError((current) => current || 'Some dashboard widgets are still loading. Refresh in a moment.')
        }
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Unable to load dashboard data right now.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    fetchDashboardData()
    return () => controller.abort()
  }, [user?.rollNumber])

  const courseAttendanceRows = useMemo(() => {
    return attendance
      .map((entry) => ({
        code: entry?.course?.code || 'N/A',
        name: normalizeCourseDisplayName(entry?.course?.name),
        percentage: Number(entry?.percentage || 0),
        totalDelivered: Number(entry?.total_delivered || 0),
      }))
      .filter((entry) => entry.totalDelivered > 0 || entry.percentage > 0)
      .sort((left, right) => left.code.localeCompare(right.code))
  }, [attendance])

  const averageAttendance = useMemo(() => {
    if (courseAttendanceRows.length === 0) {
      return 0
    }
    const total = courseAttendanceRows.reduce((sum, item) => sum + item.percentage, 0)
    return Math.round(total / courseAttendanceRows.length)
  }, [courseAttendanceRows])

  const classWindow = useMemo(() => {
    const parsedSessions = sessions
      .map((session) => {
        const startAt = combineDateAndTime(session.date, session.start_time)
        const endAt = combineDateAndTime(session.date, session.end_time)
        if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
          return null
        }
        return {
          ...session,
          startAt,
          endAt,
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.startAt - right.startAt)

    const byDate = parsedSessions.reduce((accumulator, session) => {
      if (!accumulator.has(session.date)) {
        accumulator.set(session.date, [])
      }
      accumulator.get(session.date).push(session)
      return accumulator
    }, new Map())

    const now = new Date(clock)
    const todayIso = toIsoDate(now)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowIso = toIsoDate(tomorrow)

    let title = "Today's Classes"
    let targetDateIso = todayIso
    let daySessions = byDate.get(todayIso) || []

    const hasUnfinishedToday = daySessions.some((session) => session.endAt.getTime() >= clock)
    if (!hasUnfinishedToday || daySessions.length === 0) {
      title = "Tomorrow's Classes"
      targetDateIso = tomorrowIso
      daySessions = byDate.get(tomorrowIso) || []
    }

    if (daySessions.length === 0) {
      const nextDateIso = [...byDate.keys()].find(
        (dateIso) => new Date(`${dateIso}T00:00:00`).getTime() >= clock,
      )
      if (nextDateIso) {
        title = 'Upcoming Classes'
        targetDateIso = nextDateIso
        daySessions = byDate.get(nextDateIso) || []
      }
    }

    const nextUpcomingClass = parsedSessions.find((session) => session.startAt.getTime() >= clock) || null
    const currentLiveClass =
      parsedSessions.find(
        (session) => session.startAt.getTime() <= clock && session.endAt.getTime() >= clock,
      ) || null

    return {
      title,
      targetDateIso,
      classes: daySessions.slice(0, MAX_DASHBOARD_CLASSES),
      nextUpcomingClass,
      currentLiveClass,
    }
  }, [sessions, clock])

  const nextMeal = useMemo(() => {
    const grouped = new Map()

    messItems.forEach((item) => {
      const slot = getMealSlot(item.category)
      if (!slot || !item.date) {
        return
      }

      const key = `${item.date}:${slot.key}`
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: slot.label,
          date: item.date,
          startAt: createDateWithTime(item.date, slot.startHour, slot.startMinute),
          endAt: createDateWithTime(item.date, slot.endHour, slot.endMinute),
          items: [],
        })
      }

      grouped.get(key).items.push(item.item_name)
    })

    const sortedMeals = [...grouped.values()].sort((left, right) => left.startAt - right.startAt)
    return sortedMeals.find((meal) => meal.endAt.getTime() >= clock) || sortedMeals[0] || null
  }, [messItems, clock])

  const nextMealItems = useMemo(() => {
    if (!nextMeal) {
      return []
    }
    return prioritizeMealItemsForWidget(nextMeal.label, nextMeal.items).slice(0, 3)
  }, [nextMeal])

  const assignmentRows = useMemo(
    () =>
      upcomingAssignments.map((assignment) => ({
        ...assignment,
        deadline: getAssignmentDeadlineMeta(assignment, clock),
      })),
    [upcomingAssignments, clock],
  )

  const attendanceByCourseCode = useMemo(() => {
    const map = new Map()
    courseAttendanceRows.forEach((item) => {
      map.set(String(item.code || '').toUpperCase(), Number(item.percentage || 0))
    })
    return map
  }, [courseAttendanceRows])

  const countdown = getCountdown(classWindow.nextUpcomingClass?.startAt)
  const liveCountdown = getCountdown(classWindow.currentLiveClass?.endAt)
  const isClassLive = Boolean(classWindow.currentLiveClass)
  const timerValue = isClassLive ? liveCountdown : countdown
  const timerLabel = isClassLive ? 'Class live now' : classWindow.nextUpcomingClass ? 'Next class in' : 'Schedule'
  const timerCourseName = normalizeCourseDisplayName(
    classWindow.currentLiveClass?.raw_text ||
      classWindow.currentLiveClass?.course?.name ||
      classWindow.nextUpcomingClass?.raw_text ||
      classWindow.nextUpcomingClass?.course?.name ||
      '',
  )
  const averageAttendanceHealth = getAttendanceHealth(averageAttendance)
  const hasRecentMaterialUpdate = useMemo(() => {
    if (!readingsSummary.latestMaterialAt) {
      return false
    }
    const updatedAtEpoch = new Date(readingsSummary.latestMaterialAt).getTime()
    if (Number.isNaN(updatedAtEpoch)) {
      return false
    }
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    return Date.now() - updatedAtEpoch <= sevenDaysMs
  }, [readingsSummary.latestMaterialAt])

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 rounded-2xl bg-slate-50 md:grid-cols-3 lg:grid-cols-4">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative col-span-1 overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-900 via-[#1E3A8A] to-[#2B4EA2] p-6 text-white shadow-[0_4px_24px_rgb(0,0,0,0.04)] md:col-span-3 lg:col-span-2"
        >
          <div className="absolute -right-8 -top-10 h-44 w-44 rounded-full bg-cyan-200/20 blur-2xl" />
          <div className="absolute -bottom-16 left-0 h-44 w-44 rounded-full bg-blue-200/20 blur-3xl" />

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/75">
                {classWindow.title}
              </p>
              <h2 className="mt-3 heading-tight max-w-xl text-3xl font-semibold leading-tight sm:text-4xl">
                {classWindow.targetDateIso
                  ? formatDateLabel(`${classWindow.targetDateIso}T00:00:00`)
                  : 'No classes scheduled'}
              </h2>
            </div>

            <div className="min-w-[180px] rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    isClassLive ? 'animate-pulse bg-emerald-400' : 'bg-cyan-100',
                  )}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                  {timerLabel}
                </p>
              </div>
              <p className="heading-tight mt-2 text-2xl font-bold">{timerValue}</p>
              {timerCourseName ? (
                <p className="mt-1 text-xs text-white/80">{timerCourseName}</p>
              ) : null}
            </div>
          </div>

          {classWindow.classes.length > 0 ? (
            <>
              <div className="mt-6 space-y-3">
                {classWindow.classes.map((session) => {
                  const sessionCourseCode = String(session?.course?.code || '').toUpperCase()
                  const attendancePercentage = attendanceByCourseCode.get(sessionCourseCode)
                  const shouldAttend =
                    Number.isFinite(attendancePercentage) && Number(attendancePercentage) < 75
                  const isLiveSession =
                    session.startAt.getTime() <= clock && session.endAt.getTime() >= clock

                  return (
                    <article
                      key={session.id}
                      className={cn(
                        'rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm',
                        isLiveSession && 'ring-1 ring-emerald-300/70',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            isLiveSession ? 'animate-pulse bg-emerald-400' : sessionColorClass(session),
                          )}
                        />
                        <p className="text-sm font-semibold text-white">
                          {session.raw_text || session.course?.name || 'Class'}
                        </p>
                        {isLiveSession ? (
                          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100">
                            Live
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-white/80">
                        {formatTimeLabel(session.startAt)} - {formatTimeLabel(session.endAt)} • Room{' '}
                        {session.room}
                      </p>
                      {shouldAttend ? (
                        <p className="mt-2 text-[11px] font-semibold text-amber-100">
                          You should attend this session
                        </p>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-white/80">No classes found for this schedule window.</p>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className={cn(DASHBOARD_CARD_CLASS, 'h-full flex flex-col lg:col-span-2')}
        >
          <div className="mb-4 flex items-center gap-2">
            <BellRing className="h-5 w-5 text-iim-blue" />
            <h3 className={DASHBOARD_CARD_TITLE_CLASS}>Announcements</h3>
          </div>
          <p className={cn(DASHBOARD_CARD_SUBTEXT_CLASS, 'mb-3')}>Notices and poll alerts.</p>

          {recentAnnouncements.length === 0 ? (
            <p className="text-sm text-slate-500">No announcements posted yet.</p>
          ) : (
            <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
              {recentAnnouncements.map((announcement) => (
                <article
                  key={announcement.id}
                  className={cn(
                    'rounded-xl bg-slate-50/80 p-4',
                    announcement?._is_poll_alert && 'bg-amber-50',
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{announcement.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{announcement.content}</p>
                  <p className="mt-2 text-[11px] font-medium text-slate-500">
                    {announcement.posted_by} • {formatDateLabel(announcement.created_at)}
                  </p>
                  {announcement?._is_poll_alert ? (
                    <Link
                      to="/dashboard/polls"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-iim-blue hover:underline"
                    >
                      Open Polls
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className={cn(DASHBOARD_CARD_CLASS, 'h-full flex flex-col lg:col-span-2')}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className={DASHBOARD_CARD_TITLE_CLASS}>Attendance by Course</h3>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                averageAttendanceHealth.badgeClass,
              )}
            >
              Avg {averageAttendance}%
            </span>
          </div>
          <p className={DASHBOARD_CARD_SUBTEXT_CLASS}>Live percentage by subject.</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              90+ Excellent
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-lime-500" />
              85-89 Strong
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              80-84 Stable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              75-79 Watch
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Below 75 Critical
            </span>
          </div>

          <div className="mt-4 flex-1">
            {courseAttendanceRows.length === 0 ? (
              <p className="text-sm text-slate-500">Attendance percentages are not available yet.</p>
            ) : (
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {courseAttendanceRows.map((item) => {
                  const health = getAttendanceHealth(item.percentage)
                  return (
                    <div key={item.code} className="rounded-xl bg-slate-50/80 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', courseColorClass(item.code))} />
                          <p className="text-sm font-semibold text-slate-800">{item.code}</p>
                        </div>
                        <p className={cn('text-xs font-semibold', health.textClass)}>
                          {item.percentage.toFixed(2)}%
                        </p>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className={cn('h-2 rounded-full', health.barClass)}
                          style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">{item.name}</p>
                        <p className={cn('text-[11px] font-semibold', health.textClass)}>{health.label}</p>
                      </div>
                      {item.percentage < 75 ? (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600">
                          Important: Attend upcoming classes
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.44, delay: 0.15 }}
          className={cn(DASHBOARD_CARD_CLASS, 'group h-full flex flex-col lg:col-span-1')}
        >
          <Link to="/dashboard/mess-menu" className="flex h-full flex-1 flex-col justify-between">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-iim-gold transition group-hover:scale-105 group-hover:bg-amber-100">
              <UtensilsCrossed className="h-6 w-6" />
            </div>
            <div className="mt-10">
              <p className={DASHBOARD_CARD_TITLE_CLASS}>Next Meal</p>
              <p className={DASHBOARD_CARD_SUBTEXT_CLASS}>Mess timeline and next serving.</p>
              {nextMeal ? (
                <>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {nextMeal.label} • {formatDateLabel(`${nextMeal.date}T00:00:00`)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Starts around {formatTimeLabel(nextMeal.startAt)}
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {nextMealItems.map((item) => (
                      <p key={item} className="line-clamp-1 text-xs text-slate-600">
                        • {item}
                      </p>
                    ))}
                    {nextMeal.items.length > nextMealItems.length ? (
                      <p className="text-xs text-slate-500">+{nextMeal.items.length - nextMealItems.length} more</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No upcoming meal menu available.</p>
              )}
            </div>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-iim-blue">
              Open menu <ChevronRight className="h-4 w-4" />
            </span>
          </Link>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.46, delay: 0.18 }}
          className={cn(DASHBOARD_CARD_CLASS, 'h-full flex flex-col lg:col-span-1')}
        >
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-iim-blue" />
            <h3 className={DASHBOARD_CARD_TITLE_CLASS}>Upcoming Assignments</h3>
          </div>
          <p className={cn(DASHBOARD_CARD_SUBTEXT_CLASS, 'mb-3')}>Deadlines and quick details.</p>

          <div className="flex-1">
            {assignmentRows.length === 0 ? (
              <p className="text-sm text-slate-500">No upcoming assignments right now.</p>
            ) : (
              <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                {assignmentRows.map((assignment) => (
                  <article key={assignment.id} className={cn('rounded-xl p-3', assignment.deadline.classes)}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{assignment.title}</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {assignment.course?.code || 'N/A'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-700">
                      Due {formatDateLabel(`${assignment.due_date}T00:00:00`)} • {assignment.deadline.text}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAssignments((current) => ({
                          ...current,
                          [assignment.id]: !current[assignment.id],
                        }))
                      }
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-iim-blue"
                    >
                      Details
                      {expandedAssignments[assignment.id] ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {expandedAssignments[assignment.id] ? (
                      <p className="mt-2 rounded-xl bg-white/80 px-2.5 py-2 text-xs text-slate-700">
                        {assignment.description || 'No additional details provided.'}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </motion.section>

        <div className="space-y-6 lg:col-span-2">
            <motion.section
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.2 }}
              className={cn(DASHBOARD_CARD_CLASS, 'group')}
            >
              <Link to="/dashboard/readings" className="flex h-full flex-col justify-between">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue transition group-hover:scale-105 group-hover:bg-blue-100">
                  <BookOpenText className="h-6 w-6" />
                </div>

                <div className="mt-10">
                  <p className={DASHBOARD_CARD_TITLE_CLASS}>Course Materials</p>
                  <p className={cn(DASHBOARD_CARD_SUBTEXT_CLASS, 'mt-1')}>
                    {readingsSummary.totalMaterials > 0
                      ? `${readingsSummary.totalMaterials} published material${
                          readingsSummary.totalMaterials > 1 ? 's' : ''
                        } available`
                      : 'No materials uploaded yet'}
                  </p>
                  {readingsSummary.latestMaterialAt ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Latest update: {formatDateLabel(readingsSummary.latestMaterialAt)}
                      {readingsSummary.latestCourseCode ? ` (${readingsSummary.latestCourseCode})` : ''}
                    </p>
                  ) : null}
                  {hasRecentMaterialUpdate ? (
                    <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      New material uploaded recently
                    </p>
                  ) : null}
                </div>

                <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-iim-blue">
                  Open Course Materials <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.24 }}
              className={cn(DASHBOARD_CARD_CLASS, 'relative overflow-hidden')}
            >
              <div className="absolute -right-10 -top-8 h-28 w-28 rounded-full bg-white/50 blur-2xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  <Cake className="h-4 w-4 text-iim-blue" />
                  Birthday Tracker
                </div>
                {birthdaysToday.length > 0 ? (
                  <>
                    <p className="mt-4 text-lg font-bold text-slate-800">Happy Birthday!</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {birthdaysToday.map((student) => (
                        <span
                          key={student.roll_number}
                          className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-slate-800"
                        >
                          {student.name}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-4 text-lg font-bold text-slate-800">No birthdays today</p>
                    <p className="mt-2 text-sm text-slate-700">
                      This card will auto-highlight students when their birthday matches today.
                    </p>
                  </>
                )}
              </div>
            </motion.section>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl border border-slate-100 bg-white shadow-[0_4px_24px_rgb(0,0,0,0.04)]"
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
