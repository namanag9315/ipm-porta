import { ClipboardCheck, Clock3, ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import api from '../lib/api'
import { formatDateLabel } from '../lib/date'

function assignmentDeadlineMeta(assignment) {
  const dueAt = assignment?.due_at
    ? new Date(assignment.due_at)
    : new Date(`${assignment?.due_date}T${assignment?.due_time || '23:59:00'}`)
  const now = Date.now()
  const delta = dueAt.getTime() - now
  const hoursLeft = Math.floor(delta / (1000 * 60 * 60))
  const daysLeft = Math.floor(delta / (1000 * 60 * 60 * 24))

  if (delta < 0) {
    return {
      text: 'Deadline passed',
      classes: 'bg-slate-100 border-slate-300 text-slate-600',
    }
  }
  if (delta < 24 * 60 * 60 * 1000) {
    return {
      text: `${Math.max(0, hoursLeft)}h left`,
      classes: 'bg-rose-50 border-rose-200 text-rose-700 font-bold',
    }
  }
  if (delta <= 3 * 24 * 60 * 60 * 1000) {
    return {
      text: `${Math.max(1, daysLeft)}d left`,
      classes: 'bg-amber-50 border-amber-200 text-amber-700',
    }
  }
  return {
    text: `${Math.max(1, daysLeft)}d left`,
    classes: 'bg-slate-50 border-slate-200 text-slate-700',
  }
}

export default function AssignmentsView() {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    async function fetchAssignments() {
      setLoading(true)
      setError('')
      try {
        const response = await api.get('/api/v1/dashboard-extras/')
        setAssignments(Array.isArray(response.data?.upcoming_assignments) ? response.data.upcoming_assignments : [])
      } catch (fetchError) {
        setError(fetchError?.response?.data?.detail || 'Unable to load assignments.')
      } finally {
        setLoading(false)
      }
    }
    fetchAssignments()
  }, [])

  const rows = useMemo(
    () =>
      assignments.map((assignment) => ({
        ...assignment,
        deadline: assignmentDeadlineMeta(assignment),
      })),
    [assignments],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="heading-tight text-2xl font-semibold text-slate-900">Assignments</h1>
            <p className="text-sm text-slate-500">Track deadlines and open details for every task.</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-3xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-soft">
          No upcoming assignments.
        </div>
      ) : null}

      {!loading ? (
        <div className="space-y-3">
          {rows.map((assignment) => {
            const isExpanded = expandedId === assignment.id
            return (
              <article key={assignment.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="heading-tight text-lg font-semibold text-slate-900">{assignment.title}</h2>
                    <p className="text-sm text-slate-500">
                      {assignment.course?.code || 'N/A'} • Due {formatDateLabel(`${assignment.due_date}T00:00:00`)}
                    </p>
                  </div>
                  <span className={`rounded-xl border px-2.5 py-1 text-xs ${assignment.deadline.classes}`}>
                    <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                    {assignment.deadline.text}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : assignment.id)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-iim-blue"
                >
                  Details
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {isExpanded ? (
                  <div className="mt-2 space-y-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <p>{assignment.description || 'No description provided.'}</p>
                    {(assignment.group_members_list || assignment.group_members) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(Array.isArray(assignment.group_members_list)
                          ? assignment.group_members_list
                          : String(assignment.group_members || '')
                              .split(/\n|,|;/g)
                              .map((item) => item.trim())
                              .filter(Boolean)
                        ).map((member) => (
                          <span
                            key={`${assignment.id}-${member}`}
                            className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                          >
                            {member}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
