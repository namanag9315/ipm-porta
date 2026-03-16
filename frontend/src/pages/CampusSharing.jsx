import { AnimatePresence, motion } from 'framer-motion'
import {
  Car,
  CheckCircle2,
  Clock3,
  IndianRupee,
  MapPin,
  Plus,
  ShoppingBasket,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'

const WHATSAPP_MESSAGE = encodeURIComponent(
  'Hey! I saw your post on the IPM Portal and wanted to join.',
)

function getTodayIsoDate() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
}

function formatDate(value) {
  if (!value) {
    return 'N/A'
  }
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(value) {
  if (!value) {
    return 'N/A'
  }
  const parsed = new Date(`2000-01-01T${value}`)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function buildWhatsAppLink(whatsappNumber) {
  const normalized = String(whatsappNumber || '').replace(/\D/g, '')
  return `https://wa.me/91${normalized}?text=${WHATSAPP_MESSAGE}`
}

function isOwnedByUser(item, rollNumber) {
  return (
    String(item?.creator_roll_number || '')
      .trim()
      .toUpperCase() === String(rollNumber || '').trim().toUpperCase()
  )
}

export default function CampusSharing() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('cab')
  const [cabPools, setCabPools] = useState([])
  const [orderPools, setOrderPools] = useState([])
  const [sellPosts, setSellPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionBusyId, setActionBusyId] = useState('')
  const [formError, setFormError] = useState('')
  const [postType, setPostType] = useState('cab')
  const [formState, setFormState] = useState({
    destination: '',
    departure_date: getTodayIsoDate(),
    time_window: '',
    available_seats: '3',
    hostel_block: '',
    order_type: 'blinkit',
    order_deadline: '',
    title: '',
    description: '',
    expected_price: '',
    whatsapp_number: '',
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadPosts() {
      setLoading(true)
      setError('')
      try {
        const [cabResponse, orderResponse, sellResponse] = await Promise.all([
          api.get('/api/v1/sharing/cab-pools/', { signal: controller.signal }),
          api.get('/api/v1/sharing/blinkit-pools/', { signal: controller.signal }),
          api.get('/api/v1/sharing/sell-posts/', { signal: controller.signal }),
        ])
        setCabPools(Array.isArray(cabResponse.data) ? cabResponse.data : [])
        setOrderPools(Array.isArray(orderResponse.data) ? orderResponse.data : [])
        setSellPosts(Array.isArray(sellResponse.data) ? sellResponse.data : [])
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Unable to load campus sharing posts right now.')
        }
      } finally {
        setLoading(false)
      }
    }

    loadPosts()
    return () => controller.abort()
  }, [])

  const activeItems = useMemo(() => {
    if (activeTab === 'cab') {
      return cabPools
    }
    if (activeTab === 'order') {
      return orderPools
    }
    return sellPosts
  }, [activeTab, cabPools, orderPools, sellPosts])

  function openCreateModal() {
    setPostType(activeTab === 'order' ? 'order' : activeTab)
    setFormError('')
    setIsCreateOpen(true)
  }

  function resetForm() {
    setFormState({
      destination: '',
      departure_date: getTodayIsoDate(),
      time_window: '',
      available_seats: '3',
      hostel_block: '',
      order_type: 'blinkit',
      order_deadline: '',
      title: '',
      description: '',
      expected_price: '',
      whatsapp_number: '',
    })
  }

  function removeFromState(type, id) {
    if (type === 'cab') {
      setCabPools((current) => current.filter((item) => item.id !== id))
      return
    }
    if (type === 'order') {
      setOrderPools((current) => current.filter((item) => item.id !== id))
      return
    }
    setSellPosts((current) => current.filter((item) => item.id !== id))
  }

  async function handleOwnerAction(type, id, action) {
    if (!user?.rollNumber) {
      return
    }

    const key = `${type}-${id}-${action}`
    setActionBusyId(key)
    setError('')

    const endpointMap = {
      cab: `/api/v1/sharing/cab-pools/${id}/`,
      order: `/api/v1/sharing/blinkit-pools/${id}/`,
      sell: `/api/v1/sharing/sell-posts/${id}/`,
    }
    const endpoint = endpointMap[type]

    try {
      if (action === 'delete') {
        await api.delete(endpoint, {
          headers: { 'X-Student-Roll-Number': user.rollNumber },
        })
        removeFromState(type, id)
      } else {
        await api.patch(
          endpoint,
          { action: 'fulfill' },
          { headers: { 'X-Student-Roll-Number': user.rollNumber } },
        )
        removeFromState(type, id)
      }
    } catch {
      setError('Unable to update this post right now.')
    } finally {
      setActionBusyId('')
    }
  }

  async function submitPost(event) {
    event.preventDefault()
    if (!user?.rollNumber) {
      setFormError('Unable to detect logged-in student. Please log in again.')
      return
    }

    setSubmitting(true)
    setFormError('')
    try {
      const endpointMap = {
        cab: '/api/v1/sharing/cab-pools/',
        order: '/api/v1/sharing/blinkit-pools/',
        sell: '/api/v1/sharing/sell-posts/',
      }
      const endpoint = endpointMap[postType]

      const payload =
        postType === 'cab'
          ? {
              destination: formState.destination,
              departure_date: formState.departure_date,
              time_window: formState.time_window,
              available_seats: Number(formState.available_seats || 0),
              whatsapp_number: formState.whatsapp_number,
            }
          : postType === 'order'
            ? {
                hostel_block: formState.hostel_block,
                order_type: formState.order_type,
                order_deadline: formState.order_deadline,
                whatsapp_number: formState.whatsapp_number,
              }
            : {
                title: formState.title,
                description: formState.description,
                expected_price:
                  formState.expected_price !== '' ? Number(formState.expected_price) : null,
                whatsapp_number: formState.whatsapp_number,
              }

      const response = await api.post(endpoint, payload, {
        headers: { 'X-Student-Roll-Number': user.rollNumber },
      })

      if (postType === 'cab') {
        setCabPools((current) => [response.data, ...current])
      } else if (postType === 'order') {
        setOrderPools((current) => [response.data, ...current])
      } else {
        setSellPosts((current) => [response.data, ...current])
      }
      setIsCreateOpen(false)
      resetForm()
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail
      if (detail) {
        setFormError(detail)
      } else if (typeof submitError?.response?.data === 'object') {
        const firstError = Object.values(submitError.response.data)[0]
        setFormError(Array.isArray(firstError) ? String(firstError[0]) : 'Invalid input.')
      } else {
        setFormError('Unable to create post right now.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="min-h-screen bg-[#F8FAFC] p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="heading-tight text-2xl font-bold text-slate-900">Campus Sharing</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cab pools, Blinkit/Night Mess orders, and student marketplace in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-900"
        >
          <Plus className="h-4 w-4" />
          Create Post
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-soft">
        <button
          type="button"
          onClick={() => setActiveTab('cab')}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
            activeTab === 'cab' ? 'bg-iim-blue text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <Car className="h-4 w-4" />
          Cab Pools
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('order')}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
            activeTab === 'order' ? 'bg-iim-blue text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <ShoppingBasket className="h-4 w-4" />
          Blinkit / Night Mess
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sell')}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
            activeTab === 'sell' ? 'bg-iim-blue text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <IndianRupee className="h-4 w-4" />
          Sell Items
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-2xl bg-white shadow-soft" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {activeItems.map((item) => {
            const isOwner = isOwnedByUser(item, user?.rollNumber)
            const fulfillKey = `${activeTab}-${item.id}-fulfill`
            const deleteKey = `${activeTab}-${item.id}-delete`

            return (
              <article key={`${activeTab}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                {activeTab === 'cab' ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Cab Pool</p>
                    <h3 className="mt-2 text-xl font-bold text-slate-900">{item.destination}</h3>
                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                      <p className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-iim-blue" />
                        {formatDate(item.departure_date)} | {item.time_window}
                      </p>
                      <p className="inline-flex items-center gap-2">
                        <Users className="h-4 w-4 text-iim-blue" />
                        Seats left: {item.available_seats}
                      </p>
                    </div>
                  </>
                ) : null}

                {activeTab === 'order' ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {item.order_type === 'night_mess' ? 'Night Mess Order' : 'Blinkit Bulk Order'}
                    </p>
                    <h3 className="mt-2 text-xl font-bold text-slate-900">{item.hostel_block}</h3>
                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                      <p className="inline-flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-iim-blue" />
                        Order by: {formatTime(item.order_deadline)}
                      </p>
                    </div>
                  </>
                ) : null}

                {activeTab === 'sell' ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Marketplace</p>
                    <h3 className="mt-2 text-xl font-bold text-slate-900">{item.title}</h3>
                    {item.description ? <p className="mt-2 text-sm text-slate-600">{item.description}</p> : null}
                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                      {item.expected_price !== null && item.expected_price !== undefined && item.expected_price !== '' ? (
                        <p className="inline-flex items-center gap-2 font-semibold text-slate-800">
                          <IndianRupee className="h-4 w-4 text-iim-blue" />
                          Expected: Rs {item.expected_price}
                        </p>
                      ) : (
                        <p className="text-slate-500">Price on discussion</p>
                      )}
                    </div>
                  </>
                ) : null}

                <p className="mt-3 text-xs text-slate-500">Posted by {item.creator_name || 'Student'}</p>
                <a
                  href={buildWhatsAppLink(item.whatsapp_number)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600"
                >
                  Contact on WhatsApp
                </a>

                {isOwner ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleOwnerAction(activeTab, item.id, 'fulfill')}
                      disabled={actionBusyId === fulfillKey || actionBusyId === deleteKey}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Fulfilled
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOwnerAction(activeTab, item.id, 'delete')}
                      disabled={actionBusyId === fulfillKey || actionBusyId === deleteKey}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}

          {activeItems.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-soft">
              No active posts right now. Create one and start sharing.
            </div>
          ) : null}
        </div>
      )}

      <AnimatePresence>
        {isCreateOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCreateOpen(false)}
          >
            <motion.aside
              initial={{ x: 440 }}
              animate={{ x: 0 }}
              exit={{ x: 440 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Create Campus Sharing Post</h3>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <form onSubmit={submitPost} className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Post Type
                  <select
                    value={postType}
                    onChange={(event) => setPostType(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  >
                    <option value="cab">Cab Pool</option>
                    <option value="order">Blinkit / Night Mess</option>
                    <option value="sell">Sell Item</option>
                  </select>
                </label>

                {postType === 'cab' ? (
                  <>
                    <label className="block text-sm font-medium text-slate-700">
                      Destination
                      <input
                        type="text"
                        required
                        value={formState.destination}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, destination: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Departure Date
                      <input
                        type="date"
                        required
                        value={formState.departure_date}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, departure_date: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Time Window
                      <input
                        type="text"
                        required
                        placeholder="4:00 PM - 5:00 PM"
                        value={formState.time_window}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, time_window: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Available Seats
                      <input
                        type="number"
                        min="1"
                        required
                        value={formState.available_seats}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, available_seats: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </>
                ) : null}

                {postType === 'order' ? (
                  <>
                    <label className="block text-sm font-medium text-slate-700">
                      Order Type
                      <select
                        value={formState.order_type}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, order_type: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      >
                        <option value="blinkit">Blinkit</option>
                        <option value="night_mess">Night Mess</option>
                      </select>
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Hostel Block
                      <input
                        type="text"
                        required
                        value={formState.hostel_block}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, hostel_block: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Order Deadline
                      <input
                        type="time"
                        required
                        value={formState.order_deadline}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, order_deadline: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </>
                ) : null}

                {postType === 'sell' ? (
                  <>
                    <label className="block text-sm font-medium text-slate-700">
                      Item Title
                      <input
                        type="text"
                        required
                        value={formState.title}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, title: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Description
                      <textarea
                        rows={3}
                        value={formState.description}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, description: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Expected Price (optional)
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={formState.expected_price}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, expected_price: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </>
                ) : null}

                <label className="block text-sm font-medium text-slate-700">
                  WhatsApp Number (10 digits)
                  <input
                    type="text"
                    pattern="\d{10}"
                    maxLength={10}
                    required
                    value={formState.whatsapp_number}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        whatsapp_number: event.target.value.replace(/\D/g, '').slice(0, 10),
                      }))
                    }
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                  />
                </label>

                {formError ? (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {formError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-iim-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? 'Creating...' : 'Create Post'}
                </button>
              </form>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
