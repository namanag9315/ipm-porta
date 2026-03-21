import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

import api from '../lib/api'
import { cn } from '../lib/cn'
import { formatDateLabel, startOfWeek, toIsoDate } from '../lib/date'

function buildWeekDays(anchorDate = new Date()) {
  const start = startOfWeek(anchorDate)
  return Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return {
      iso: toIsoDate(day),
      shortDay: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(day),
      shortDate: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(day),
    }
  })
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner']

const MEAL_CARD_STYLES = {
  Breakfast: 'border-amber-200 bg-amber-50/50',
  Lunch: 'border-emerald-200 bg-emerald-50/40',
  Dinner: 'border-indigo-200 bg-indigo-50/40',
}

const HOT_BREAKFAST_SECTION_HINTS = ['hot', 'preparation']
const HOT_BREAKFAST_ITEM_HINTS = [
  'poha',
  'upma',
  'paratha',
  'puri',
  'bhatura',
  'idli',
  'dosa',
  'uttapam',
  'omelette',
  'cutlet',
  'sandwich',
  'chilla',
]

function parseMealCategory(category) {
  const [mealPart, ...restParts] = String(category || '')
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!mealPart) {
    return null
  }

  const normalizedMeal = mealPart.toLowerCase()
  const meal = MEAL_ORDER.find((candidate) => normalizedMeal.includes(candidate.toLowerCase()))
  if (!meal) {
    return null
  }

  return {
    meal,
    section: restParts.join(' - ') || 'Items',
  }
}

function sectionPriorityForBreakfast(section) {
  const normalized = String(section || '').toLowerCase()
  return HOT_BREAKFAST_SECTION_HINTS.some((hint) => normalized.includes(hint)) ? 0 : 1
}

function itemPriorityForBreakfast(item) {
  const normalized = String(item || '').toLowerCase()
  return HOT_BREAKFAST_ITEM_HINTS.some((hint) => normalized.includes(hint)) ? 0 : 1
}

export default function MessMenuView() {
  const todayIso = toIsoDate(new Date())
  const [weekAnchorIso, setWeekAnchorIso] = useState(todayIso)
  const weekDays = useMemo(
    () => buildWeekDays(new Date(`${weekAnchorIso}T00:00:00`)),
    [weekAnchorIso],
  )

  const [menuMap, setMenuMap] = useState({})
  const [activeDate, setActiveDate] = useState(todayIso)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadWeekMenu() {
      setLoading(true)
      setError('')

      try {
        const responses = await Promise.all(
          weekDays.map((day) => api.get(`/api/v1/mess-menu/?date=${day.iso}`, { signal: controller.signal })),
        )

        const nextMap = {}
        weekDays.forEach((day, index) => {
          nextMap[day.iso] = Array.isArray(responses[index].data) ? responses[index].data : []
        })

        const hasAnyItems = Object.values(nextMap).some((items) => Array.isArray(items) && items.length > 0)
        if (!hasAnyItems) {
          const fallbackResponses = await Promise.all(
            weekDays.map((day) =>
              api.get(`/api/v1/mess-menu/?date=${day.iso}&template_fallback=1`, {
                signal: controller.signal,
              }),
            ),
          )
          weekDays.forEach((day, index) => {
            nextMap[day.iso] = Array.isArray(fallbackResponses[index].data)
              ? fallbackResponses[index].data
              : []
          })
        }

        setMenuMap(nextMap)
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Unable to load mess menu for the selected week.')
        }
      } finally {
        setLoading(false)
      }
    }

    loadWeekMenu()
    return () => controller.abort()
  }, [weekDays, todayIso, weekAnchorIso])

  useEffect(() => {
    if (!weekDays.some((day) => day.iso === activeDate)) {
      setActiveDate(weekDays[0]?.iso || todayIso)
    }
  }, [weekDays, activeDate, todayIso])

  const activeItems = useMemo(() => menuMap[activeDate] || [], [menuMap, activeDate])

  const groupedByMeal = useMemo(() => {
    const mealMaps = new Map(MEAL_ORDER.map((meal) => [meal, new Map()]))

    activeItems.forEach((item) => {
      const parsed = parseMealCategory(item.category)
      if (!parsed) {
        return
      }

      const sectionsMap = mealMaps.get(parsed.meal)
      if (!sectionsMap.has(parsed.section)) {
        sectionsMap.set(parsed.section, [])
      }
      sectionsMap.get(parsed.section).push(item.item_name)
    })

    return MEAL_ORDER.map((meal) => {
      let sections = Array.from(mealMaps.get(meal).entries()).map(([section, items]) => ({
        section,
        items: [...new Set(items)],
      }))

      if (meal === 'Breakfast') {
        sections = sections
          .sort((left, right) => {
            const rankDiff =
              sectionPriorityForBreakfast(left.section) - sectionPriorityForBreakfast(right.section)
            if (rankDiff !== 0) {
              return rankDiff
            }
            return left.section.localeCompare(right.section)
          })
          .map((sectionBlock) => ({
            ...sectionBlock,
            items: [...sectionBlock.items].sort((left, right) => {
              const rankDiff = itemPriorityForBreakfast(left) - itemPriorityForBreakfast(right)
              if (rankDiff !== 0) {
                return rankDiff
              }
              return left.localeCompare(right)
            }),
          }))
      }

      const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0)
      return {
        meal,
        sections,
        totalItems,
      }
    })
  }, [activeItems])

  return (
    <section className="space-y-5">
      <div>
        <h2 className="heading-tight text-2xl font-bold text-slate-900">Mess Menu</h2>
        <p className="mt-1 text-sm text-slate-500">Browse meals by day with categorized menu cards.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full gap-2 rounded-2xl border border-slate-200/70 bg-white p-2 shadow-soft">
          {weekDays.map((day) => {
            const isActive = day.iso === activeDate
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setActiveDate(day.iso)}
                className={cn(
                  'min-w-[112px] rounded-xl px-4 py-3 text-left transition',
                  isActive
                    ? 'bg-iim-blue text-white shadow-glow-blue'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <p className="text-sm font-semibold tracking-tight">{day.shortDay}</p>
                <p className={cn('text-xs', isActive ? 'text-white/80' : 'text-slate-500')}>
                  {day.shortDate}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft">
        <p className="text-sm font-medium text-slate-500">Selected day</p>
        <p className="heading-tight mt-1 text-xl font-semibold text-slate-900">
          {formatDateLabel(`${activeDate}T00:00:00`)}
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && groupedByMeal.every((meal) => meal.totalItems === 0) ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-soft">
          No menu entries found for this date.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {groupedByMeal.map((mealBlock, index) => (
          <motion.article
            key={mealBlock.meal}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.2) }}
            className={cn(
              'rounded-2xl border p-5 shadow-soft',
              MEAL_CARD_STYLES[mealBlock.meal] || 'border-slate-200/70 bg-white',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="heading-tight text-lg font-semibold text-slate-900">{mealBlock.meal}</h3>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {mealBlock.totalItems} items
              </span>
            </div>

            {mealBlock.sections.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No {mealBlock.meal.toLowerCase()} menu uploaded.</p>
            ) : (
              <div className="mt-4 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                {mealBlock.sections.map((sectionBlock) => (
                  <div key={`${mealBlock.meal}-${sectionBlock.section}`} className="rounded-xl bg-white/80 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {sectionBlock.section}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                      {sectionBlock.items.map((item) => (
                        <li key={`${mealBlock.meal}-${sectionBlock.section}-${item}`}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </motion.article>
        ))}
      </div>
    </section>
  )
}
