import { Calculator, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { calculateGPA, convertToPercentage, GRADE_POINTS } from '../utils/gradeCalculator'

const gradeOptions = Object.keys(GRADE_POINTS)

function createCourseRow(id) {
  return {
    id,
    name: '',
    credits: 3,
    grade: gradeOptions[0] || 'A',
  }
}

export default function GradeCalculator() {
  const [courses, setCourses] = useState([createCourseRow(1)])

  const targetGPA = useMemo(() => calculateGPA(courses), [courses])
  const equivalentPercentage = useMemo(
    () => convertToPercentage(targetGPA),
    [targetGPA],
  )

  function updateCourse(courseId, patch) {
    setCourses((current) =>
      current.map((course) => (course.id === courseId ? { ...course, ...patch } : course)),
    )
  }

  function addCourse() {
    setCourses((current) => [...current, createCourseRow(Date.now())])
  }

  function removeCourse(courseId) {
    setCourses((current) => {
      if (current.length <= 1) {
        return current
      }
      return current.filter((course) => course.id !== courseId)
    })
  }

  return (
    <section className="min-h-screen bg-[#F8FAFC] p-8">
      <header className="mb-8 flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-iim-blue">
          <Calculator className="h-5 w-5" />
        </span>
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Grade Simulator</h2>
          <p className="mt-1 text-sm text-slate-500">
            Model your target TGPA instantly by adjusting grades and credits.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <article className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Course Inputs</h3>
            <button
              type="button"
              onClick={addCourse}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-iim-blue transition hover:border-blue-300 hover:bg-blue-100"
            >
              <Plus className="h-4 w-4" />
              Add Course
            </button>
          </div>

          <div className="space-y-4">
            {courses.map((course, index) => (
              <div
                key={course.id}
                className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-[1.5fr_0.6fr_0.7fr_auto]"
              >
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Course Name
                  <input
                    type="text"
                    value={course.name}
                    onChange={(event) => updateCourse(course.id, { name: event.target.value })}
                    placeholder={`Course ${index + 1}`}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Credits
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={course.credits}
                    onChange={(event) =>
                      updateCourse(course.id, {
                        credits: Number(event.target.value || 0),
                      })
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Target Grade
                  <select
                    value={course.grade}
                    onChange={(event) => updateCourse(course.id, { grade: event.target.value })}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  >
                    {gradeOptions.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => removeCourse(course.id)}
                  disabled={courses.length <= 1}
                  className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
          <h3 className="text-lg font-semibold text-slate-900">Projected Results</h3>

          <div className="mt-6 rounded-2xl bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Target TGPA</p>
            <p className="mt-2 bg-gradient-to-r from-iim-blue to-blue-500 bg-clip-text text-5xl font-extrabold text-transparent">
              {targetGPA.toFixed(2)}
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Equivalent Percentage
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{equivalentPercentage.toFixed(2)}%</p>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Calculations based on the official IPM grading matrix.
          </p>
        </aside>
      </div>
    </section>
  )
}
