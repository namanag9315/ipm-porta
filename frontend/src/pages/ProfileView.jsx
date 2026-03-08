import { motion } from 'framer-motion'
import { LockKeyhole, Save, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'

export default function ProfileView() {
  const { user, updateUserProfile } = useAuth()

  const [profile, setProfile] = useState({
    roll_number: '',
    section: '',
    name: '',
    email: '',
    date_of_birth: '',
  })

  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })

  const [loadingProfile, setLoadingProfile] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const [profileMessage, setProfileMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadProfile() {
      if (!user?.rollNumber) {
        setLoadingProfile(false)
        return
      }

      setLoadingProfile(true)
      setError('')
      try {
        const response = await api.get(`/api/v1/profile/${user.rollNumber}/`, {
          signal: controller.signal,
        })
        const data = response.data || {}
        setProfile({
          roll_number: data.roll_number || user.rollNumber,
          section: data.section || '',
          name: data.name || '',
          email: data.email || '',
          date_of_birth: data.date_of_birth || '',
        })
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Unable to load profile details right now.')
        }
      } finally {
        setLoadingProfile(false)
      }
    }

    loadProfile()
    return () => controller.abort()
  }, [user?.rollNumber])

  const handleProfileChange = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }))
    setProfileMessage('')
    setError('')
  }

  const handlePasswordChange = (field, value) => {
    setPasswordForm((current) => ({ ...current, [field]: value }))
    setPasswordMessage('')
    setError('')
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    if (!user?.rollNumber) {
      return
    }

    setSavingProfile(true)
    setError('')
    setProfileMessage('')

    try {
      const response = await api.patch(`/api/v1/profile/${user.rollNumber}/`, {
        name: profile.name,
        email: profile.email,
        date_of_birth: profile.date_of_birth || null,
      })
      const data = response.data || {}

      setProfile((current) => ({
        ...current,
        name: data.name || current.name,
        email: data.email || current.email,
        date_of_birth: data.date_of_birth || '',
        section: data.section || current.section,
      }))

      updateUserProfile({
        name: data.name || profile.name,
        email: data.email || profile.email,
        section: data.section || profile.section,
        dateOfBirth: data.date_of_birth || null,
      })

      setProfileMessage('Profile updated successfully.')
    } catch (saveError) {
      setError(saveError?.response?.data?.detail || 'Failed to save profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (event) => {
    event.preventDefault()
    if (!user?.rollNumber) {
      return
    }

    setChangingPassword(true)
    setError('')
    setPasswordMessage('')

    try {
      const response = await api.post(`/api/v1/profile/${user.rollNumber}/change-password/`, {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_password: passwordForm.confirm_password,
      })
      setPasswordMessage(response?.data?.detail || 'Password changed successfully.')
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (passwordError) {
      setError(passwordError?.response?.data?.detail || 'Failed to change password.')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="heading-tight text-2xl font-bold text-slate-900">Profile & Security</h2>
        <p className="mt-1 text-sm text-slate-500">
          Update your personal details and change your account password.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <motion.article
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft"
        >
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-5 w-5 text-iim-blue" />
            <h3 className="heading-tight text-lg font-semibold text-slate-900">Personal Information</h3>
          </div>

          {loadingProfile ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : (
            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Roll Number</span>
                  <input
                    value={profile.roll_number}
                    disabled
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-700"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Section</span>
                  <input
                    value={profile.section}
                    disabled
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-700"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span>
                <input
                  value={profile.name}
                  onChange={(event) => handleProfileChange('name', event.target.value)}
                  required
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(event) => handleProfileChange('email', event.target.value)}
                  required
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date of Birth</span>
                <input
                  type="date"
                  value={profile.date_of_birth || ''}
                  onChange={(event) => handleProfileChange('date_of_birth', event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
                />
              </label>

              {profileMessage ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {profileMessage}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Save className="h-4 w-4" />
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          )}
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.03 }}
          className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft"
        >
          <div className="mb-4 flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-iim-blue" />
            <h3 className="heading-tight text-lg font-semibold text-slate-900">Change Password</h3>
          </div>

          <form onSubmit={changePassword} className="space-y-4">
            <label className="space-y-1 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Password</span>
              <input
                type="password"
                value={passwordForm.current_password}
                onChange={(event) => handlePasswordChange('current_password', event.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
              />
            </label>

            <label className="space-y-1 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Password</span>
              <input
                type="password"
                value={passwordForm.new_password}
                onChange={(event) => handlePasswordChange('new_password', event.target.value)}
                required
                minLength={8}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
              />
            </label>

            <label className="space-y-1 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirm New Password</span>
              <input
                type="password"
                value={passwordForm.confirm_password}
                onChange={(event) => handlePasswordChange('confirm_password', event.target.value)}
                required
                minLength={8}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-iim-blue focus:outline-none focus:ring-2 focus:ring-iim-blue/20"
              />
            </label>

            {passwordMessage ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {passwordMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={changingPassword}
              className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LockKeyhole className="h-4 w-4" />
              {changingPassword ? 'Updating...' : 'Change Password'}
            </button>
          </form>
        </motion.article>
      </div>
    </section>
  )
}
