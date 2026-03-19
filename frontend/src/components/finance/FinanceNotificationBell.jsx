import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import api from '../../lib/api'

export default function FinanceNotificationBell() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let isMounted = true

    async function fetchCount() {
      try {
        const response = await api.get('/api/v1/finance/notifications/')
        if (isMounted) {
          setCount(Number(response?.data?.count || 0))
        }
      } catch {
        if (isMounted) {
          setCount(0)
        }
      }
    }

    fetchCount()
    const intervalId = setInterval(fetchCount, 30000)
    return () => {
      isMounted = false
      clearInterval(intervalId)
    }
  }, [])

  return (
    <Link
      to="/dashboard#settle-up"
      aria-label="Pending dues notifications"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
    >
      <Bell className="h-5 w-5" />
      {count > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
