import {
  ExternalLink,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import FinanceNotificationBell from '../components/finance/FinanceNotificationBell'
import Sidebar from '../components/layout/Sidebar'

const TIMETABLE_MASTER_SHEET_URL =
  import.meta.env.VITE_TIMETABLE_MASTER_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/1dnzXBXlF4-OpVblhj4DJM6kJ5l-FEACjWwun7ntTGXk/edit'

export default function DashboardLayout() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isTimetableRoute = location.pathname === '/dashboard/timetable'

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="relative min-h-screen bg-hero-mesh">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.75)_0%,rgba(248,250,252,0.95)_45%,rgba(248,250,252,1)_100%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="custom-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col justify-between overflow-y-auto overflow-x-hidden rounded-3xl bg-iim-blue p-6 shadow-soft lg:flex">
          <div>
            <div className="mb-10">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
                IIM Indore
              </p>
              <h2 className="mt-2 heading-tight text-2xl font-bold text-white">IPM Portal</h2>
            </div>

            <Sidebar />
          </div>

          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/50 hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </aside>

        <AnimatePresence>
          {mobileMenuOpen ? (
            <>
              <motion.button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileMenuOpen(false)}
                className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
              <motion.aside
                className="custom-scrollbar fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-xs flex-col justify-between overflow-y-auto rounded-r-3xl bg-iim-blue p-6 shadow-soft lg:hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              >
                <div>
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
                        IIM Indore
                      </p>
                      <h2 className="mt-2 heading-tight text-2xl font-bold text-white">IPM Portal</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 text-slate-200 transition hover:bg-white/10"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <Sidebar
                    onNavigate={() => {
                      setMobileMenuOpen(false)
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/50 hover:bg-white/10"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>

        <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col">
          <header className="sticky top-0 z-20 mb-6 rounded-2xl border border-white/60 bg-white/60 px-5 py-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    Good to see you
                  </p>
                  <h1 className="heading-tight mt-1 text-xl font-semibold text-slate-900">
                    {user?.name || user?.rollNumber || 'IPM Student'}
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <FinanceNotificationBell />
                {isTimetableRoute ? (
                  <a
                    href={TIMETABLE_MASTER_SHEET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-white px-[12px] py-[7px] text-[12px] font-medium text-slate-700 [border:0.5px_solid_rgba(0,0,0,0.12)] transition hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Master Sheet
                  </a>
                ) : null}

                <div className="inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/70 px-3 py-2 shadow-sm">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-iim-blue text-sm font-semibold text-white">
                    {(user?.name || user?.rollNumber || 'S').charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-xs text-slate-500">Roll Number</p>
                    <p className="text-sm font-medium text-slate-800">{user?.rollNumber || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 rounded-3xl bg-surface-bg/70 p-4 sm:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  )
}
