import {
  BellRing,
  BookOpenText,
  Bus,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileCheck2,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  ShieldCheck,
  UserRoundCog,
  Users,
  UtensilsCrossed,
  WalletCards,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { cn } from '../../lib/cn'

const hubSections = [
  {
    key: 'academics',
    title: 'Academics',
    items: [
      { to: '/dashboard/timetable', label: 'Timetable', icon: CalendarDays },
      { to: '/dashboard/attendance', label: 'Attendance', icon: ClipboardCheck },
      { to: '/dashboard/assignments', label: 'Assignments', icon: FileCheck2 },
      { to: '/dashboard/readings', label: 'Readings', icon: BookOpenText },
      { to: '/calculator', label: 'Grade Simulator', icon: Calculator },
    ],
  },
  {
    key: 'campus_life',
    title: 'Campus Life',
    items: [
      { to: '/dashboard/mess-menu', label: 'Mess Menu', icon: UtensilsCrossed },
      { to: '/dashboard/noticeboard', label: 'Noticeboard', icon: BellRing },
      { to: '/sharing', label: 'Campus Sharing', icon: Users },
      { to: '/dashboard/polls', label: 'Polls', icon: ScrollText },
      { to: '/dashboard/bus-schedule', label: 'Bus Schedule', icon: Bus },
    ],
  },
  {
    key: 'finance_hub',
    title: 'Finance Hub',
    items: [
      { to: '/dashboard/split-settle', label: 'Split & Settle', icon: WalletCards },
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

function isPathActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function HubSection({ section, isOpen, onToggle, onItemClick }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/75 transition hover:bg-white/10 hover:text-white"
      >
        <span>{section.title}</span>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isOpen ? (
        <div className="space-y-1.5">
          {section.items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={onItemClick}>
              {({ isActive }) => (
                <div
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-white/14 text-white'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <span
                    className={cn(
                      'absolute bottom-2 left-0 top-2 w-1 rounded-r-full',
                      isActive ? 'bg-cyan-300' : 'bg-transparent',
                    )}
                  />
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      isActive ? 'text-white' : 'text-blue-100/70 group-hover:text-white',
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

export default function Sidebar({ onNavigate }) {
  const location = useLocation()
  const [openSections, setOpenSections] = useState({
    academics: true,
    campus_life: true,
    finance_hub: true,
    admin_tools: true,
  })

  useEffect(() => {
    setOpenSections((current) => {
      const next = { ...current }
      hubSections.forEach((section) => {
        const hasActiveItem = section.items.some((item) => isPathActive(location.pathname, item.to))
        if (hasActiveItem) {
          next[section.key] = true
        }
      })
      return next
    })
  }, [location.pathname])

  function toggleSection(key) {
    setOpenSections((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  return (
    <nav className="space-y-5">
      <NavLink to="/dashboard" end onClick={onNavigate}>
        {({ isActive }) => (
          <div
            className={cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-white/14 text-white' : 'text-blue-100/80 hover:bg-white/10 hover:text-white',
            )}
          >
            <span
              className={cn(
                'absolute bottom-2 left-0 top-2 w-1 rounded-r-full',
                isActive ? 'bg-cyan-300' : 'bg-transparent',
              )}
            />
            <LayoutDashboard
              className={cn(
                'h-4 w-4',
                isActive ? 'text-white' : 'text-blue-100/70 group-hover:text-white',
              )}
            />
            <span>Dashboard</span>
          </div>
        )}
      </NavLink>

      {hubSections.map((section) => (
        <HubSection
          key={section.key}
          section={section}
          isOpen={Boolean(openSections[section.key])}
          onToggle={() => toggleSection(section.key)}
          onItemClick={onNavigate}
        />
      ))}
    </nav>
  )
}
