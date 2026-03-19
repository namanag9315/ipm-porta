import { CheckCircle2, Clock3, Loader2, PlusCircle, Search, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import SettleUpCard from '../components/finance/SettleUpCard'
import api from '../lib/api'
import { formatDateLabel } from '../lib/date'

function formatMoney(value) {
  const numeric = Number(value || 0)
  return `Rs ${numeric.toFixed(2)}`
}

function statusLabel(record) {
  if (record?.is_settled) {
    return 'Settled'
  }
  if (record?.debtor_confirmed && !record?.creditor_confirmed) {
    return 'Awaiting creditor confirmation'
  }
  if (!record?.debtor_confirmed) {
    return 'Awaiting debtor payment'
  }
  return 'Open'
}

export default function SplitSettleView() {
  const [debtorRollNumber, setDebtorRollNumber] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [studentOptions, setStudentOptions] = useState([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [actionLoadingId, setActionLoadingId] = useState('')
  const [records, setRecords] = useState({
    summary: {
      total_you_owe: '0.00',
      total_owed_to_you: '0.00',
      pending_debtor_validation: 0,
      pending_creditor_validation: 0,
      total_records: 0,
    },
    you_owe: [],
    owed_to_you: [],
    history: [],
  })

  useEffect(() => {
    let isMounted = true
    const timerId = setTimeout(async () => {
      setLoadingStudents(true)
      try {
        const response = await api.get('/api/v1/finance/students/', {
          params: {
            q: studentQuery,
          },
        })
        if (isMounted) {
          setStudentOptions(Array.isArray(response.data) ? response.data : [])
        }
      } catch {
        if (isMounted) {
          setStudentOptions([])
        }
      } finally {
        if (isMounted) {
          setLoadingStudents(false)
        }
      }
    }, 220)

    return () => {
      isMounted = false
      clearTimeout(timerId)
    }
  }, [studentQuery])

  const studentByRoll = useMemo(() => {
    const map = new Map()
    studentOptions.forEach((student) => {
      map.set(student.roll_number, student)
    })
    return map
  }, [studentOptions])

  async function fetchRecords() {
    setRecordsLoading(true)
    try {
      const response = await api.get('/api/v1/finance/records/')
      const data = response.data || {}
      setRecords({
        summary: data.summary || {
          total_you_owe: '0.00',
          total_owed_to_you: '0.00',
          pending_debtor_validation: 0,
          pending_creditor_validation: 0,
          total_records: 0,
        },
        you_owe: Array.isArray(data.you_owe) ? data.you_owe : [],
        owed_to_you: Array.isArray(data.owed_to_you) ? data.owed_to_you : [],
        history: Array.isArray(data.history) ? data.history : [],
      })
    } catch {
      setRecords({
        summary: {
          total_you_owe: '0.00',
          total_owed_to_you: '0.00',
          pending_debtor_validation: 0,
          pending_creditor_validation: 0,
          total_records: 0,
        },
        you_owe: [],
        owed_to_you: [],
        history: [],
      })
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [])

  async function submitRecordAction(transactionId, action) {
    setError('')
    setSuccess('')
    setActionLoadingId(`${action}-${transactionId}`)
    try {
      await api.patch(`/api/v1/finance/settle/${transactionId}/`, {
        action,
      })
      await fetchRecords()
      setSuccess(
        action === 'mark_paid'
          ? 'Marked as paid. Waiting for creditor confirmation.'
          : 'Payment confirmed and transaction updated.',
      )
    } catch (actionError) {
      setError(actionError?.response?.data?.detail || 'Unable to update this transaction right now.')
    } finally {
      setActionLoadingId('')
    }
  }

  async function submitSplit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    const nextErrors = {}

    const normalizedRoll = debtorRollNumber.trim().toUpperCase()
    const parsedAmount = Number(amount)
    const trimmedDescription = description.trim()

    if (!normalizedRoll) {
      nextErrors.debtor = 'Select a debtor from the list.'
    } else if (!studentByRoll.has(normalizedRoll)) {
      nextErrors.debtor = 'Please choose a valid student from suggestions.'
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      nextErrors.amount = 'Amount must be greater than zero.'
    }
    if (trimmedDescription.length < 3) {
      nextErrors.description = 'Description must be at least 3 characters.'
    }

    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)

    try {
      await api.post('/api/v1/finance/split/', {
        debtor_roll_number: normalizedRoll,
        amount: parsedAmount.toFixed(2),
        description: trimmedDescription,
      })

      setDebtorRollNumber('')
      setStudentQuery('')
      setAmount('')
      setDescription('')
      setFieldErrors({})
      setSuccess('Split created successfully.')
      await fetchRecords()
    } catch (submitError) {
      setError(submitError?.response?.data?.detail || 'Unable to create split right now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
            <WalletCards className="h-6 w-6" />
          </div>
          <div>
            <h1 className="heading-tight text-2xl font-semibold text-slate-900">Split &amp; Settle</h1>
            <p className="text-sm text-slate-500">
              Split shared spends and settle pending dues quickly with UPI QR.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center gap-2">
          <PlusCircle className="h-5 w-5 text-iim-blue" />
          <h2 className="heading-tight text-lg font-semibold text-slate-900">Create Split</h2>
        </div>

        <form onSubmit={submitSplit} className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Search Student
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                value={studentQuery}
                onChange={(event) => {
                  const value = event.target.value
                  setStudentQuery(value)
                  setDebtorRollNumber(value.trim().toUpperCase())
                  setFieldErrors((current) => ({ ...current, debtor: '' }))
                }}
                list="finance-student-options"
                className="h-11 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                placeholder="Type name or roll number"
                required
              />
            </div>

            <datalist id="finance-student-options">
              {studentOptions.map((student) => (
                <option
                  key={student.roll_number}
                  value={student.roll_number}
                  label={`${student.name} (${student.section})`}
                />
              ))}
            </datalist>

            {loadingStudents ? (
              <p className="mt-1 text-[11px] text-slate-500">Loading students...</p>
            ) : null}
            {fieldErrors.debtor ? (
              <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.debtor}</p>
            ) : null}
          </label>

          <label className="text-sm font-medium text-slate-700">
            Debtor Roll Number
            <input
              value={debtorRollNumber}
              disabled
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-700"
              placeholder="Select from search"
            />
          </label>

          <label className="text-sm font-medium text-slate-700">
            Amount (INR)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setFieldErrors((current) => ({ ...current, amount: '' }))
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              placeholder="350"
              required
            />
            {fieldErrors.amount ? (
              <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.amount}</p>
            ) : null}
          </label>

          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Description
            <input
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                setFieldErrors((current) => ({ ...current, description: '' }))
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              placeholder="Cab to railway station"
              required
            />
            {fieldErrors.description ? (
              <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.description}</p>
            ) : null}
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Create Split
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-3xl border border-rose-200 bg-rose-50 p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Total You Owe</p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{formatMoney(records.summary.total_you_owe)}</p>
          <p className="mt-1 text-xs text-rose-700/80">
            Pending your validation: {records.summary.pending_debtor_validation || 0}
          </p>
        </article>
        <article className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Total Owed To You</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{formatMoney(records.summary.total_owed_to_you)}</p>
          <p className="mt-1 text-xs text-emerald-700/80">
            Pending your validation: {records.summary.pending_creditor_validation || 0}
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-rose-600" />
            <h3 className="heading-tight text-lg font-semibold text-slate-900">You Owe</h3>
          </div>
          {recordsLoading ? (
            <p className="text-sm text-slate-500">Loading records...</p>
          ) : records.you_owe.length === 0 ? (
            <p className="text-sm text-slate-500">No pending payments.</p>
          ) : (
            <div className="space-y-3">
              {records.you_owe.map((record) => (
                <div key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-800">
                    You owe <span className="font-semibold">{record.creditor_name}</span>{' '}
                    <span className="font-semibold">{formatMoney(record.amount)}</span> for {record.description}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{statusLabel(record)}</p>
                  {record.can_mark_paid ? (
                    <button
                      type="button"
                      onClick={() => submitRecordAction(record.id, 'mark_paid')}
                      disabled={actionLoadingId === `mark_paid-${record.id}`}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-iim-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                    >
                      {actionLoadingId === `mark_paid-${record.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      I Have Paid
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <h3 className="heading-tight text-lg font-semibold text-slate-900">People Owe You</h3>
          </div>
          {recordsLoading ? (
            <p className="text-sm text-slate-500">Loading records...</p>
          ) : records.owed_to_you.length === 0 ? (
            <p className="text-sm text-slate-500">No pending receivables.</p>
          ) : (
            <div className="space-y-3">
              {records.owed_to_you.map((record) => (
                <div key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-800">
                    <span className="font-semibold">{record.debtor_name}</span> owes you{' '}
                    <span className="font-semibold">{formatMoney(record.amount)}</span> for {record.description}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{statusLabel(record)}</p>
                  {record.can_confirm_received ? (
                    <button
                      type="button"
                      onClick={() => submitRecordAction(record.id, 'confirm_received')}
                      disabled={actionLoadingId === `confirm_received-${record.id}`}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                    >
                      {actionLoadingId === `confirm_received-${record.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Confirm Received
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <h3 className="heading-tight text-lg font-semibold text-slate-900">Transaction History</h3>
        {recordsLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading history...</p>
        ) : records.history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No transactions yet.</p>
        ) : (
          <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {records.history.map((record) => (
              <div key={record.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    {record.debtor_name} to {record.creditor_name}
                  </p>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {statusLabel(record)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {formatMoney(record.amount)} • {record.description}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Created: {formatDateLabel(record.created_at)} {record.settled_at ? `• Settled: ${formatDateLabel(record.settled_at)}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <SettleUpCard />
    </div>
  )
}
