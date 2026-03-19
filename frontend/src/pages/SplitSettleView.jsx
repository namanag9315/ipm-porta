import { Loader2, PlusCircle, WalletCards } from 'lucide-react'
import { useState } from 'react'

import SettleUpCard from '../components/finance/SettleUpCard'
import api from '../lib/api'

export default function SplitSettleView() {
  const [debtorRollNumber, setDebtorRollNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submitSplit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      await api.post('/api/v1/finance/split/', {
        debtor_roll_number: debtorRollNumber.trim().toUpperCase(),
        amount,
        description,
      })

      setDebtorRollNumber('')
      setAmount('')
      setDescription('')
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
            Debtor Roll Number
            <input
              value={debtorRollNumber}
              onChange={(event) => setDebtorRollNumber(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              placeholder="2023IPM079"
              required
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Amount (INR)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              placeholder="350"
              required
            />
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-1">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
              placeholder="Cab to railway station"
              required
            />
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
