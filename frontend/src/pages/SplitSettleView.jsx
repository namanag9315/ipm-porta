import { Loader2, PlusCircle, Search, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import SettleUpCard from '../components/finance/SettleUpCard'
import api from '../lib/api'

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

      <SettleUpCard />
    </div>
  )
}
