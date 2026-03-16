import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Calculator, Download, Plus, Target, Trash2, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  calculateRequiredGPA,
  calculateWeightedGPA,
  convertToPercentage,
  GRADE_SIMULATOR_CONSTANTS,
} from '../utils/gradeCalculator'
import { cn } from '../lib/cn'
import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { getAttendanceInsights } from '../lib/attendance'

const ENTRY_TYPES = ['Entire Year', 'Single Term', 'Single Subject']

function createEntry(id) {
  return {
    id,
    type: 'Single Term',
    label: '',
    credits: '3',
    gradePoint: '',
  }
}

function parsePositiveNumber(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }
  return parsed
}

function parseFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

export default function GradeSimulator() {
  const [activeTab, setActiveTab] = useState('tracker')
  const [entries, setEntries] = useState([createEntry(1)])
  const [plannerInput, setPlannerInput] = useState({
    currentGPA: '',
    currentCredits: '',
    targetPercentage: '70',
    remainingCredits: '',
  })

  const { user } = useAuth()
  const [availableCourses, setAvailableCourses] = useState([])

  useEffect(() => {
    if (!user?.rollNumber) return

    async function loadCourses() {
      try {
        const response = await api.get(`/api/v1/attendance/${user.rollNumber}/`)
        const records = Array.isArray(response.data) ? response.data : []
        const courses = records.map(record => {
          const insights = getAttendanceInsights(record)
          return {
            code: record?.course?.code || 'N/A',
            name: record?.course?.name || record?.course?.code || 'Unknown Course',
            credits: insights.credits || record?.course?.credits || 3
          }
        }).filter(c => c.code !== 'N/A')

        const uniqueCourses = Array.from(new Map(courses.map(c => [c.code, c])).values())
        setAvailableCourses(uniqueCourses)
      } catch (err) {
        console.error("Failed to fetch available courses:", err)
      }
    }

    loadCourses()
  }, [user?.rollNumber])

  const [termSubjects, setTermSubjects] = useState([
    { id: 1, name: 'Development Economics', credits: 3, gradePoint: 2.6 }
  ])

  const normalizedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        credits: parsePositiveNumber(entry.credits),
        gradePoint: parseFiniteNumber(entry.gradePoint),
      })),
    [entries],
  )

  const totalCreditsCompleted = useMemo(
    () => normalizedEntries.reduce((sum, entry) => sum + (entry.credits > 0 ? entry.credits : 0), 0),
    [normalizedEntries],
  )

  const currentGPA = useMemo(
    () => calculateWeightedGPA(normalizedEntries),
    [normalizedEntries],
  )

  useEffect(() => {
    setPlannerInput((current) => ({
      ...current,
      currentGPA:
        current.currentGPA === '' ? (currentGPA > 0 ? currentGPA.toFixed(2) : '') : current.currentGPA,
      currentCredits:
        current.currentCredits === ''
          ? (totalCreditsCompleted > 0 ? String(totalCreditsCompleted) : '')
          : current.currentCredits,
    }))
  }, [currentGPA, totalCreditsCompleted])

  const effectiveCurrentGPA = parseFiniteNumber(plannerInput.currentGPA)
  const effectiveCurrentCredits = parsePositiveNumber(plannerInput.currentCredits)
  const targetPercentage = parseFiniteNumber(plannerInput.targetPercentage)
  const remainingCredits = parsePositiveNumber(plannerInput.remainingCredits)

  const requiredGPA = useMemo(
    () =>
      calculateRequiredGPA(
        effectiveCurrentGPA,
        effectiveCurrentCredits,
        targetPercentage,
        remainingCredits,
      ),
    [effectiveCurrentGPA, effectiveCurrentCredits, targetPercentage, remainingCredits],
  )

  const isPlannerInputComplete =
    Number.isFinite(effectiveCurrentGPA) &&
    effectiveCurrentCredits > 0 &&
    Number.isFinite(targetPercentage) &&
    remainingCredits > 0

  const impossibleTarget =
    isPlannerInputComplete &&
    Number.isFinite(requiredGPA) &&
    requiredGPA > GRADE_SIMULATOR_CONSTANTS.MAX_GPA

  const normalizedTermSubjects = useMemo(
    () => termSubjects.map(subject => ({
      credits: parsePositiveNumber(subject.credits),
      gradePoint: parseFiniteNumber(subject.gradePoint)
    })),
    [termSubjects]
  )

  const termTotalCredits = useMemo(
    () => normalizedTermSubjects.reduce((sum, subject) => sum + (subject.credits > 0 ? subject.credits : 0), 0),
    [normalizedTermSubjects]
  )

  const termTGPA = useMemo(
    () => calculateWeightedGPA(normalizedTermSubjects),
    [normalizedTermSubjects]
  )

  function addTermSubject() {
    setTermSubjects((current) => [...current, { id: Date.now(), name: '', credits: 3, gradePoint: '' }])
  }

  function updateTermSubject(id, field, value) {
    setTermSubjects((current) =>
      current.map((subject) => (subject.id === id ? { ...subject, [field]: value } : subject))
    )
  }

  function removeTermSubject(id) {
    setTermSubjects((current) => current.filter((subject) => subject.id !== id))
  }

  function exportToCSV() {
    const lines = []

    // ── Title Block ──
    lines.push(["IPM PORTAL - Grade Report"])
    lines.push([`Generated: ${new Date().toLocaleString()}`])
    lines.push([])

    // ── Section 1 : CGPA Tracker ──
    lines.push(["SECTION 1: CGPA TRACKER"])
    lines.push(["#", "Entry Type", "Label", "Credits", "Grade Point"])
    entries.forEach((entry, i) => {
      lines.push([
        i + 1,
        `"${entry.type}"`,
        `"${entry.label || `Record ${i + 1}`}"`,
        entry.credits,
        entry.gradePoint || "—"
      ])
    })
    lines.push([])
    lines.push(["", "", "TOTAL CREDITS", totalCreditsCompleted.toFixed(2)])
    lines.push(["", "", "CURRENT CGPA", currentGPA.toFixed(2)])
    lines.push(["", "", "EQUIVALENT %", convertToPercentage(currentGPA).toFixed(2) + "%"])
    lines.push([])
    lines.push([])

    // ── Section 2 : Target Goal Planner ──
    lines.push(["SECTION 2: TARGET GOAL PLANNER"])
    lines.push(["Parameter", "Value"])
    lines.push(["Current GPA", plannerInput.currentGPA || "—"])
    lines.push(["Credits Completed", plannerInput.currentCredits || "—"])
    lines.push(["Target Percentage", plannerInput.targetPercentage ? `${plannerInput.targetPercentage}%` : "—"])
    lines.push(["Remaining Credits", plannerInput.remainingCredits || "—"])
    lines.push([])
    const reqGPADisplay = isPlannerInputComplete && Number.isFinite(requiredGPA) ? requiredGPA.toFixed(2) : "N/A"
    lines.push(["REQUIRED GPA", reqGPADisplay, impossibleTarget ? "Target is mathematically impossible" : ""])
    lines.push([])
    lines.push([])

    // ── Section 3 : Term TGPA Builder ──
    lines.push(["SECTION 3: TERM TGPA BUILDER"])
    lines.push(["#", "Subject", "Credits", "Grade Point"])
    termSubjects.forEach((subject, i) => {
      lines.push([
        i + 1,
        `"${subject.name || 'Unnamed Subject'}"`,
        subject.credits,
        subject.gradePoint || "—"
      ])
    })
    lines.push([])
    lines.push(["", "TOTAL TERM CREDITS", termTotalCredits.toFixed(2)])
    lines.push(["", "CALCULATED TGPA", termTGPA.toFixed(2)])
    lines.push([])
    lines.push([])

    // ── Footer ──
    lines.push(["End of Report"])

    const csvContent = lines.map(row => row.join(",")).join("\n")

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", "IPM_Grade_Report.csv")
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function updateEntry(entryId, patch) {
    setEntries((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    )
  }

  function addEntry() {
    setEntries((current) => [...current, createEntry(Date.now())])
  }

  function removeEntry(entryId) {
    setEntries((current) => {
      if (current.length <= 1) {
        return current
      }
      return current.filter((entry) => entry.id !== entryId)
    })
  }

  function useTrackerValues() {
    setPlannerInput((current) => ({
      ...current,
      currentGPA: currentGPA > 0 ? currentGPA.toFixed(2) : '',
      currentCredits: totalCreditsCompleted > 0 ? String(totalCreditsCompleted) : '',
    }))
  }

  return (
    <section className="min-h-screen bg-[#F8FAFC] p-8">
      <header className="mb-6 flex items-start gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
          <Calculator className="h-6 w-6" />
        </span>
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Grade &amp; Target Simulator</h2>
          <p className="mt-1 text-sm text-slate-500">
            Track your live CGPA and goal-seek future GPA needed for your target percentage.
          </p>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-soft">
        {[
          { id: 'tracker', label: 'Current CGPA Tracker', icon: TrendingUp },
          { id: 'planner', label: 'Target Goal Planner', icon: Target },
          { id: 'term', label: 'Term TGPA Builder', icon: BookOpen },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition',
              activeTab === id
                ? 'bg-iim-blue text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'term' ? (
          <motion.div
            key="term"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="grid grid-cols-1 gap-8 lg:grid-cols-3"
          >
            <article className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
              <div className="mb-6 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900">Subject Inputs</h3>
              </div>

              <div className="space-y-4">
                {termSubjects.map((subject, index) => (
                  <div
                    key={subject.id}
                    className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[2fr_1fr_1fr_auto]"
                  >
                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Subject
                      <select
                        value={subject.name}
                        onChange={(event) => {
                          const val = event.target.value;
                          const selectedCourse = availableCourses.find(c => c.name === val);
                          if (selectedCourse) {
                            setTermSubjects((current) =>
                              current.map((s) => (s.id === subject.id ? { ...s, name: val, credits: selectedCourse.credits } : s))
                            );
                          } else {
                            updateTermSubject(subject.id, 'name', val);
                          }
                        }}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      >
                        <option value="">Select a course...</option>
                        {availableCourses.map((course) => (
                          <option key={course.code} value={course.name}>
                            {course.code} - {course.name}
                          </option>
                        ))}
                        {/* Fallback for manually typed or default values not in the list */}
                        {subject.name && !availableCourses.find(c => c.name === subject.name) && (
                          <option value={subject.name}>{subject.name}</option>
                        )}
                      </select>
                    </label>

                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Credits
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={subject.credits}
                        onChange={(event) => updateTermSubject(subject.id, 'credits', event.target.value)}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Grade Point
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={GRADE_SIMULATOR_CONSTANTS.MAX_GPA}
                        value={subject.gradePoint}
                        onChange={(event) => updateTermSubject(subject.id, 'gradePoint', event.target.value)}
                        placeholder="e.g. 2.34"
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => removeTermSubject(subject.id)}
                      className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addTermSubject}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm font-semibold text-iim-blue transition hover:border-blue-300 hover:bg-blue-100"
              >
                <Plus className="h-4 w-4" />
                Add Subject
              </button>
            </article>

            <aside className="lg:sticky lg:top-24 lg:self-start rounded-3xl border border-slate-200 bg-white p-8 shadow-soft flex flex-col justify-between" style={{ minHeight: '320px' }}>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Term Summary</h3>

                <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Total Credits
                  </p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{termTotalCredits.toFixed(2)}</p>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_0_15px_rgba(37,99,235,0.05)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Calculated TGPA
                  </p>
                  <p className="mt-2 bg-gradient-to-r from-iim-blue to-blue-500 bg-clip-text text-5xl font-extrabold text-transparent">
                    {termTGPA.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={exportToCSV}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow hover:from-emerald-600 hover:to-emerald-700 transition"
                >
                  <Download className="w-4 h-4" /> Export to Excel (CSV)
                </button>
              </div>
            </aside>
          </motion.div>
        ) : activeTab === 'tracker' ? (
          <motion.div
            key="tracker"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="grid grid-cols-1 gap-8 lg:grid-cols-3"
          >
            <article className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Academic Records</h3>
                <button
                  type="button"
                  onClick={addEntry}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-iim-blue transition hover:border-blue-300 hover:bg-blue-100"
                >
                  <Plus className="h-4 w-4" />
                  Add Record
                </button>
              </div>

              <div className="space-y-4">
                {entries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[1fr_1.5fr_0.7fr_0.8fr_auto]"
                  >
                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Entry Type
                      <select
                        value={entry.type}
                        onChange={(event) => updateEntry(entry.id, { type: event.target.value })}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      >
                        {ENTRY_TYPES.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Label
                      <input
                        type="text"
                        value={entry.label}
                        onChange={(event) => updateEntry(entry.id, { label: event.target.value })}
                        placeholder={`Record ${index + 1}`}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Credits
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entry.credits}
                        onChange={(event) => updateEntry(entry.id, { credits: event.target.value })}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Grade Point
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={GRADE_SIMULATOR_CONSTANTS.MAX_GPA}
                        value={entry.gradePoint}
                        onChange={(event) => updateEntry(entry.id, { gradePoint: event.target.value })}
                        placeholder="2.52"
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => removeEntry(entry.id)}
                      disabled={entries.length <= 1}
                      className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </article>

            <aside className="lg:sticky lg:top-24 lg:self-start rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
              <h3 className="text-lg font-semibold text-slate-900">Current Standing</h3>

              <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Total Credits Completed
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{totalCreditsCompleted.toFixed(2)}</p>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Current CGPA</p>
                <p className="mt-2 bg-gradient-to-r from-iim-blue to-blue-500 bg-clip-text text-5xl font-extrabold text-transparent">
                  {currentGPA.toFixed(2)}
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Equivalent Percentage
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{convertToPercentage(currentGPA).toFixed(2)}%</p>
              </div>
            </aside>
          </motion.div>
        ) : (
          <motion.div
            key="planner"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="grid grid-cols-1 gap-8 lg:grid-cols-3"
          >
            <article className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
              <div className="mb-6 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900">Goal Inputs</h3>
                <button
                  type="button"
                  onClick={useTrackerValues}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-iim-blue transition hover:border-blue-300 hover:bg-blue-100"
                >
                  Use Tracker Values
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Current GPA
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={GRADE_SIMULATOR_CONSTANTS.MAX_GPA}
                    value={plannerInput.currentGPA}
                    onChange={(event) =>
                      setPlannerInput((current) => ({ ...current, currentGPA: event.target.value }))
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Credits Completed
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={plannerInput.currentCredits}
                    onChange={(event) =>
                      setPlannerInput((current) => ({ ...current, currentCredits: event.target.value }))
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Target Percentage
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={plannerInput.targetPercentage}
                    onChange={(event) =>
                      setPlannerInput((current) => ({ ...current, targetPercentage: event.target.value }))
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Remaining Credits
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={plannerInput.remainingCredits}
                    onChange={(event) =>
                      setPlannerInput((current) => ({ ...current, remainingCredits: event.target.value }))
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>
              </div>
            </article>

            <aside className="lg:sticky lg:top-24 lg:self-start rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
              <h3 className="text-lg font-semibold text-slate-900">Required Performance</h3>

              <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Required GPA (Remaining Credits)
                </p>
                <p className="mt-2 bg-gradient-to-r from-iim-blue to-blue-500 bg-clip-text text-5xl font-extrabold text-transparent">
                  {isPlannerInputComplete && Number.isFinite(requiredGPA) ? requiredGPA.toFixed(2) : '--'}
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Target Percentage</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {Number.isFinite(targetPercentage) ? `${targetPercentage.toFixed(2)}%` : '--'}
                </p>
              </div>

              {impossibleTarget ? (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  Mathematically impossible. Adjust target.
                </p>
              ) : null}
            </aside>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
