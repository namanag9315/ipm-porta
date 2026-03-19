import {
  BellRing,
  BookOpenText,
  Bus,
  ChevronDown,
  ChevronUp,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  FileCheck2,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  ScrollText,
  ShieldCheck,
  UserRoundCog,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/cn'
import FinanceNotificationBell from '../components/finance/FinanceNotificationBell'

const navSections = [
  {
    key: 'academics',
    title: 'Academics',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/dashboard/timetable', label: 'Timetable', icon: CalendarDays },
      { to: '/dashboard/attendance', label: 'Attendance', icon: ClipboardCheck },
      { to: '/dashboard/assignments', label: 'Assignments', icon: FileCheck2 },
      { to: '/dashboard/readings', label: 'Readings', icon: BookOpenText },
      { to: '/calculator', label: 'Grade Simulator', icon: Calculator },
    ],
  },
  {
    key: 'campus',
    title: 'Campus Life',
    items: [
      { to: '/dashboard/mess-menu', label: 'Mess Menu', icon: UtensilsCrossed },
      { to: '/dashboard/noticeboard', label: 'Noticeboard', icon: BellRing },
      { to: '/sharing', label: 'Campus Sharing', icon: Users },
      { to: '/dashboard/polls', label: 'Polls', icon: ScrollText },
      { to: '/dashboard/bus-schedule', label: 'Bus Schedule', icon: Bus },
      { to: '/dashboard/loan-calculator', label: 'Loan Calculator', icon: IndianRupee },
    ],
  },
  {
    key: 'admin_tools',
    title: 'Admin / Tools',
    items: [
      { to: '/admin-portal', label: 'CR Portal', icon: Megaphone },
      { to: '/ipmo', label: 'IPMO Portal', icon: ShieldCheck },
      { to: '/dashboard/profile', label: 'Profile', icon: UserRoundCog },
    ],
  },
]

export default function DashboardLayout() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const [openSections, setOpenSections] = useState({
    academics: true,
    campus: true,
    admin_tools: true,
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  function toggleSection(key) {
    setOpenSections((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  function renderNavSection(section, onItemClick) {
    const isOpen = Boolean(openSections[section.key])
    return (
      <div key={section.key}>
        <button
          type="button"
          onClick={() => toggleSection(section.key)}
          className="mb-2 flex w-full items-center justify-between rounded-xl px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10"
        >
          <span>{section.title}</span>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {isOpen ? (
          <div className="space-y-2">
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={onItemClick}>
                {({ isActive }) => (
                  <div
                    className={cn(
                      'group relative flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-white/12 text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute bottom-2 left-0 top-2 w-1 rounded-r-full transition-colors duration-200',
                        isActive ? 'bg-iim-gold' : 'bg-transparent',
                      )}
                    />
                    <Icon
                      className={cn(
                        'h-4 w-4 transition-colors',
                        isActive ? 'text-white' : 'text-slate-400 group-hover:text-white',
                      )}
                    />
                    <span>{label}</span>
                  </div>
                )}
              </NavLink>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

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

            <nav className="space-y-5">{navSections.map((section) => renderNavSection(section))}</nav>
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
                  <nav className="space-y-5">
                    {navSections.map((section) =>
                      renderNavSection(section, () => {
                        setMobileMenuOpen(false)
                      }),
                    )}
                  </nav>
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
