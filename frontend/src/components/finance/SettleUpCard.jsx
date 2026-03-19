import { Loader2, QrCode, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'react-qr-code'
import { Link } from 'react-router-dom'

import api from '../../lib/api'

export default function SettleUpCard() {
  const [dues, setDues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDue, setSelectedDue] = useState(null)
  const [settling, setSettling] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function fetchDues() {
      setLoading(true)
      setError('')
      try {
        const response = await api.get('/api/v1/finance/dues/')
        if (isMounted) {
          setDues(Array.isArray(response.data) ? response.data : [])
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError?.response?.data?.detail || 'Unable to load pending dues right now.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchDues()
    return () => {
      isMounted = false
    }
  }, [])

  const upiUri = useMemo(() => {
    if (!selectedDue?.creditor_upi_id) {
      return ''
    }

    const amount = Number(selectedDue?.amount || 0).toFixed(2)
    return `upi://pay?pa=${encodeURIComponent(selectedDue.creditor_upi_id)}&pn=${encodeURIComponent(
      selectedDue.creditor_name || 'Creditor',
    )}&am=${amount}&cu=INR`
  }, [selectedDue])

  async function markAsPaid() {
    if (!selectedDue) {
      return
    }
    setSettling(true)
    setError('')
    try {
      await api.patch(`/api/v1/finance/settle/${selectedDue.id}/`, {
        action: 'mark_paid',
      })
      setDues((current) => current.filter((item) => item.id !== selectedDue.id))
      setSelectedDue(null)
    } catch (settleError) {
      setError(settleError?.response?.data?.detail || 'Unable to mark this payment as settled.')
    } finally {
      setSettling(false)
    }
  }

  return (
    <section id="settle-up" className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <QrCode className="h-5 w-5 text-iim-blue" />
        <h2 className="heading-tight text-lg font-semibold text-slate-900">Split &amp; Settle</h2>
        <Link
          to="/dashboard/split-settle"
          className="ml-auto text-xs font-semibold text-iim-blue hover:underline"
        >
          Open full tab
        </Link>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading dues...</p> : null}
      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loading && dues.length === 0 ? (
        <p className="text-sm text-slate-500">No pending dues right now.</p>
      ) : null}

      <div className="space-y-3">
        {dues.map((due) => (
          <article key={due.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="text-sm text-slate-800">
              You owe <span className="font-semibold">{due.creditor_name}</span>{' '}
              <span className="font-semibold">Rs {due.amount}</span> for {due.description}
            </p>
            <button
              type="button"
              onClick={() => setSelectedDue(due)}
              className="mt-3 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900"
            >
              Pay Now
            </button>
          </article>
        ))}
      </div>

      {selectedDue ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                Pay {selectedDue.creditor_name}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedDue(null)}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {upiUri ? (
              <div className="mx-auto w-fit rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                <QRCode value={upiUri} size={210} />
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Creditor UPI ID is not available. Ask them to add one in profile.
              </div>
            )}

            <p className="mt-3 text-center text-xs text-slate-500">
              UPI ID: {selectedDue.creditor_upi_id || 'Not set'}
            </p>

            <button
              type="button"
              disabled={settling}
              onClick={markAsPaid}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {settling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Mark as Paid
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
