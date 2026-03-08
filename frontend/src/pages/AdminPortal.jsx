import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BellRing,
  BrainCircuit,
  CalendarClock,
  ExternalLink,
  FileUp,
  FolderOpen,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import adminApi from '../lib/adminApi'
import {
  clearAdminAuth,
  getAdminAccessToken,
  getStoredAdminUser,
  storeAdminAuth,
} from '../lib/storage'

function toLocalDateTimeLabel(value) {
  if (!value) {
    return 'Not set'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Not set'
  }
  return parsed.toLocaleString()
}

function announcementStatus(announcement) {
  const now = Date.now()
  const startsAt = announcement?.starts_at ? new Date(announcement.starts_at).getTime() : null
  const expiresAt = announcement?.expires_at ? new Date(announcement.expires_at).getTime() : null

  if (startsAt && now < startsAt) {
    return { label: 'Scheduled', className: 'bg-amber-100 text-amber-700' }
  }
  if (expiresAt && now > expiresAt) {
    return { label: 'Expired', className: 'bg-slate-200 text-slate-700' }
  }
  return { label: 'Live', className: 'bg-emerald-100 text-emerald-700' }
}

export default function AdminPortal() {
  const [accessToken, setAccessToken] = useState(() => getAdminAccessToken())
  const [adminUser, setAdminUser] = useState(() => getStoredAdminUser())

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const [globalError, setGlobalError] = useState('')
  const [globalSuccess, setGlobalSuccess] = useState('')

  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedCourseDriveLink, setSelectedCourseDriveLink] = useState('')
  const [materials, setMaterials] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [panelLoading, setPanelLoading] = useState(false)
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const [announcementForm, setAnnouncementForm] = useState({
    prompt: '',
    title: '',
    content: '',
    postedBy: '',
    startsAt: '',
    expiresAt: '',
    attachment: null,
  })
  const [materialForm, setMaterialForm] = useState({
    title: '',
    description: '',
    driveLink: '',
    file: null,
    sortOrder: '',
    isPublished: true,
  })

  const isAuthenticated = Boolean(accessToken)

  const selectedCourseDetails = useMemo(() => {
    return courses.find((course) => course.code === selectedCourse) || null
  }, [courses, selectedCourse])

  useEffect(() => {
    if (!selectedCourseDetails) {
      setSelectedCourseDriveLink('')
      return
    }
    setSelectedCourseDriveLink(selectedCourseDetails.drive_link || '')
  }, [selectedCourseDetails])

  async function fetchMaterials(courseCode) {
    if (!courseCode) {
      setMaterials([])
      return
    }

    setMaterialsLoading(true)
    try {
      const response = await adminApi.get(`/api/v1/admin/course-materials/?course=${courseCode}`)
      setMaterials(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      setGlobalError(
        error?.response?.data?.detail || 'Unable to fetch course materials for the selected course.',
      )
    } finally {
      setMaterialsLoading(false)
    }
  }

  async function bootstrapPanel() {
    setPanelLoading(true)
    setGlobalError('')
    try {
      const [courseResponse, announcementResponse] = await Promise.all([
        adminApi.get('/api/v1/admin/courses/'),
        adminApi.get('/api/v1/admin/announcements/'),
      ])

      const nextCourses = Array.isArray(courseResponse.data) ? courseResponse.data : []
      const nextAnnouncements = Array.isArray(announcementResponse.data) ? announcementResponse.data : []

      setCourses(nextCourses)
      setAnnouncements(nextAnnouncements)

      const initialCourse = selectedCourse || nextCourses[0]?.code || ''
      setSelectedCourse(initialCourse)
      await fetchMaterials(initialCourse)
    } catch (error) {
      setGlobalError(
        error?.response?.data?.detail || 'Unable to load admin workspace. Please log in again.',
      )
    } finally {
      setPanelLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    bootstrapPanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !selectedCourse) {
      return
    }
    fetchMaterials(selectedCourse)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourse])

  async function handleLogin(event) {
    event.preventDefault()
    setAuthError('')
    setGlobalError('')
    setGlobalSuccess('')
    setAuthLoading(true)

    try {
      const response = await adminApi.post('/api/v1/admin/login/', { username, password })
      const token = response.data?.access
      const user = response.data?.user || null
      if (!token) {
        throw new Error('No admin token received.')
      }
      storeAdminAuth({ accessToken: token, user })
      setAccessToken(token)
      setAdminUser(user)
      setPassword('')
      setGlobalSuccess(`Signed in as ${user?.name || user?.username || 'Admin'}.`)
    } catch (error) {
      setAuthError(error?.response?.data?.detail || 'Unable to sign in to admin portal.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await adminApi.post('/api/v1/admin/logout/')
    } catch {
      // keep logout resilient even if token has already expired
    }
    clearAdminAuth()
    setAccessToken('')
    setAdminUser(null)
    setCourses([])
    setMaterials([])
    setAnnouncements([])
    setSelectedCourse('')
    setGlobalSuccess('Logged out from admin portal.')
  }

  async function runManualSync() {
    setGlobalError('')
    setGlobalSuccess('')
    setSyncLoading(true)
    try {
      const response = await adminApi.post('/api/v1/admin/run-sync/', {
        mode: 'sync',
      }, {
        timeout: 180000,
      })
      const result = response.data?.result || {}
      const timetableCreated = result?.timetable?.created ?? 0
      const attendanceUpserted = result?.attendance?.records_upserted ?? 0
      const menuCreated = result?.mess_menu?.created ?? 0
      setGlobalSuccess(
        `Sync completed. Timetable: ${timetableCreated}, Attendance updates: ${attendanceUpserted}, Mess items: ${menuCreated}.`,
      )
      if (selectedCourse) {
        await fetchMaterials(selectedCourse)
      }
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to trigger sync.')
    } finally {
      setSyncLoading(false)
    }
  }

  async function generateAnnouncementWithAI() {
    if (!announcementForm.prompt.trim()) {
      setGlobalError('Please enter a prompt before generating with AI.')
      return
    }

    setGlobalError('')
    setGlobalSuccess('')
    try {
      const response = await adminApi.post('/api/v1/admin/ai/generate-announcement/', {
        prompt: announcementForm.prompt.trim(),
      })
      setAnnouncementForm((current) => ({
        ...current,
        title: response.data?.title || current.title,
        content: response.data?.content || current.content,
      }))
      setGlobalSuccess('Announcement draft generated. Review and publish.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'AI draft generation failed.')
    }
  }

  async function createAnnouncement(event) {
    event.preventDefault()
    setGlobalError('')
    setGlobalSuccess('')

    const payload = new FormData()
    payload.append('title', announcementForm.title)
    payload.append('content', announcementForm.content)
    if (announcementForm.postedBy.trim()) {
      payload.append('posted_by', announcementForm.postedBy.trim())
    }
    if (announcementForm.startsAt) {
      payload.append('starts_at', announcementForm.startsAt)
    }
    if (announcementForm.expiresAt) {
      payload.append('expires_at', announcementForm.expiresAt)
    }
    if (announcementForm.attachment) {
      payload.append('attachment', announcementForm.attachment)
    }

    try {
      const response = await adminApi.post('/api/v1/admin/announcements/', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setAnnouncements((current) => [response.data, ...current])
      setAnnouncementForm((current) => ({
        ...current,
        title: '',
        content: '',
        startsAt: '',
        expiresAt: '',
        attachment: null,
      }))
      setGlobalSuccess('Announcement published successfully.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to publish announcement.')
    }
  }

  async function deleteAnnouncement(announcementId) {
    setGlobalError('')
    setGlobalSuccess('')
    try {
      await adminApi.delete(`/api/v1/admin/announcements/${announcementId}/`)
      setAnnouncements((current) => current.filter((item) => item.id !== announcementId))
      setGlobalSuccess('Announcement deleted.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to delete announcement.')
    }
  }

  async function saveCourseDriveLink() {
    if (!selectedCourse) {
      return
    }
    setGlobalError('')
    setGlobalSuccess('')
    try {
      const response = await adminApi.patch(`/api/v1/admin/courses/${selectedCourse}/`, {
        drive_link: selectedCourseDriveLink.trim(),
      })
      setCourses((current) =>
        current.map((course) =>
          course.code === selectedCourse
            ? {
                ...course,
                drive_link: response.data?.drive_link || '',
              }
            : course,
        ),
      )
      setGlobalSuccess('Course drive folder updated.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Unable to update course drive folder.')
    }
  }

  async function createMaterial(event) {
    event.preventDefault()
    if (!selectedCourse) {
      setGlobalError('Please select a course first.')
      return
    }

    setGlobalError('')
    setGlobalSuccess('')

    const payload = new FormData()
    payload.append('course_code', selectedCourse)
    payload.append('title', materialForm.title)
    payload.append('description', materialForm.description)
    payload.append('drive_link', materialForm.driveLink)
    payload.append('is_published', String(materialForm.isPublished))
    if (materialForm.sortOrder) {
      payload.append('sort_order', materialForm.sortOrder)
    }
    if (materialForm.file) {
      payload.append('file', materialForm.file)
    }

    try {
      await adminApi.post('/api/v1/admin/course-materials/', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMaterialForm({
        title: '',
        description: '',
        driveLink: '',
        file: null,
        sortOrder: '',
        isPublished: true,
      })
      await fetchMaterials(selectedCourse)
      setGlobalSuccess('Course material added.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to add course material.')
    }
  }

  async function removeMaterial(materialId) {
    setGlobalError('')
    setGlobalSuccess('')
    try {
      await adminApi.delete(`/api/v1/admin/course-materials/${materialId}/`)
      setMaterials((current) => current.filter((material) => material.id !== materialId))
      setGlobalSuccess('Course material deleted.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to delete material.')
    }
  }

  async function moveMaterial(materialId, direction) {
    const currentIndex = materials.findIndex((item) => item.id === materialId)
    if (currentIndex < 0) {
      return
    }
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= materials.length) {
      return
    }

    const reordered = [...materials]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    setMaterials(reordered)

    try {
      await Promise.all(
        reordered.map((material, index) =>
          adminApi.patch(`/api/v1/admin/course-materials/${material.id}/`, {
            sort_order: index + 1,
          }),
        ),
      )
      await fetchMaterials(selectedCourse)
      setGlobalSuccess('Material order updated.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'Failed to reorder materials.')
    }
  }

  async function arrangeMaterialsWithAI() {
    if (!selectedCourse) {
      setGlobalError('Please select a course first.')
      return
    }

    setGlobalError('')
    setGlobalSuccess('')
    try {
      const response = await adminApi.post('/api/v1/admin/ai/arrange-materials/', {
        course_code: selectedCourse,
      })
      setMaterials(Array.isArray(response.data) ? response.data : [])
      setGlobalSuccess('Materials arranged successfully.')
    } catch (error) {
      setGlobalError(error?.response?.data?.detail || 'AI material arrangement failed.')
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-surface-bg px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="heading-tight text-3xl font-bold text-slate-900">CR / IPMO Admin Portal</h1>
              <p className="mt-2 text-sm text-slate-500">
                Manage announcements and course materials for the student portal.
              </p>
            </div>
            <Link
              to="/login"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Student Login
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-3xl bg-gradient-to-br from-iim-blue to-blue-900 p-8 text-white shadow-soft">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
                <ShieldCheck className="h-4 w-4" />
                Restricted Workspace
              </div>
              <h2 className="mt-6 heading-tight text-2xl font-semibold">
                Publish campus updates with AI assistance
              </h2>
              <p className="mt-3 max-w-md text-sm text-blue-100">
                Time-bound notices, file attachments, and ordered course materials are all managed here.
              </p>
            </div>

            <form onSubmit={handleLogin} className="rounded-3xl border border-slate-200 bg-white p-7 shadow-soft">
              <h3 className="heading-tight text-xl font-semibold text-slate-900">Admin Sign In</h3>
              <p className="mt-1 text-sm text-slate-500">Use your Django staff credentials.</p>

              <div className="mt-6 space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Username
                  <input
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <input
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
              </div>

              {authError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <span>{authError}</span>
                  </div>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={authLoading}
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-iim-blue px-4 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {authLoading ? 'Signing in...' : 'Sign In to Admin Portal'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-bg px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-[1440px] space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                CR / IPMO Control Center
              </p>
              <h1 className="heading-tight mt-2 text-2xl font-bold text-slate-900">
                Announcement & Materials Admin
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Signed in as {adminUser?.name || adminUser?.username || 'Admin'} ({adminUser?.role || 'CR'})
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={runManualSync}
                disabled={syncLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncLoading ? 'animate-spin' : ''}`} />
                {syncLoading ? 'Syncing...' : 'Run Sync'}
              </button>
              <Link
                to="/dashboard"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Student Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </header>

        {globalError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {globalError}
          </div>
        ) : null}
        {globalSuccess ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {globalSuccess}
          </div>
        ) : null}

        {panelLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            Loading admin workspace...
          </div>
        ) : null}

        {!panelLoading ? (
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-5">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="heading-tight text-xl font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <BellRing className="h-5 w-5 text-iim-blue" />
                        Announcement Composer
                      </span>
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Create time-bound announcements and attach supporting files.
                    </p>
                  </div>
                </div>

                <form onSubmit={createAnnouncement} className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    AI Prompt
                    <textarea
                      rows={3}
                      value={announcementForm.prompt}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({ ...current, prompt: event.target.value }))
                      }
                      placeholder="Example: Draft a notice for LE quiz on 10 March, submission rules and classroom etiquette."
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={generateAnnouncementWithAI}
                    className="inline-flex items-center gap-2 rounded-xl border border-iim-blue/30 bg-blue-50 px-4 py-2 text-sm font-semibold text-iim-blue transition hover:bg-blue-100"
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate with AI
                  </button>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Title
                      <input
                        value={announcementForm.title}
                        onChange={(event) =>
                          setAnnouncementForm((current) => ({ ...current, title: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                        required
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Posted By
                      <input
                        value={announcementForm.postedBy}
                        onChange={(event) =>
                          setAnnouncementForm((current) => ({ ...current, postedBy: event.target.value }))
                        }
                        placeholder="Optional (auto-fills from logged in admin)"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </div>

                  <label className="block text-sm font-medium text-slate-700">
                    Content
                    <textarea
                      rows={5}
                      value={announcementForm.content}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({ ...current, content: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      required
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Starts At (optional)
                      <input
                        type="datetime-local"
                        value={announcementForm.startsAt}
                        onChange={(event) =>
                          setAnnouncementForm((current) => ({ ...current, startsAt: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Expires At (optional)
                      <input
                        type="datetime-local"
                        value={announcementForm.expiresAt}
                        onChange={(event) =>
                          setAnnouncementForm((current) => ({ ...current, expiresAt: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </div>

                  <label className="block text-sm font-medium text-slate-700">
                    Attachment (optional)
                    <input
                      type="file"
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          attachment: event.target.files?.[0] || null,
                        }))
                      }
                      className="mt-1 block w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-iim-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                    />
                  </label>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900"
                  >
                    <Save className="h-4 w-4" />
                    Publish Announcement
                  </button>
                </form>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="heading-tight text-xl font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <FolderOpen className="h-5 w-5 text-iim-blue" />
                        Course Materials
                      </span>
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Upload files, add links, and arrange delivery order for each subject.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={arrangeMaterialsWithAI}
                    className="inline-flex items-center gap-2 rounded-xl border border-iim-blue/30 bg-blue-50 px-4 py-2 text-sm font-semibold text-iim-blue transition hover:bg-blue-100"
                  >
                    <BrainCircuit className="h-4 w-4" />
                    Arrange with AI
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[0.55fr_0.45fr]">
                  <label className="block text-sm font-medium text-slate-700">
                    Course
                    <select
                      value={selectedCourse}
                      onChange={(event) => setSelectedCourse(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                    >
                      {courses.map((course) => (
                        <option key={course.code} value={course.code}>
                          {course.code} - {course.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Course Drive Folder
                      <input
                        value={selectedCourseDriveLink}
                        onChange={(event) => setSelectedCourseDriveLink(event.target.value)}
                        placeholder="https://drive.google.com/..."
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={saveCourseDriveLink}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Save className="h-4 w-4" />
                      Save Drive Link
                    </button>
                  </div>
                </div>

                <form onSubmit={createMaterial} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Material Title
                      <input
                        value={materialForm.title}
                        onChange={(event) =>
                          setMaterialForm((current) => ({ ...current, title: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                        required
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Sort Order (optional)
                      <input
                        type="number"
                        min="0"
                        value={materialForm.sortOrder}
                        onChange={(event) =>
                          setMaterialForm((current) => ({ ...current, sortOrder: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                  </div>

                  <label className="block text-sm font-medium text-slate-700">
                    Description
                    <textarea
                      rows={3}
                      value={materialForm.description}
                      onChange={(event) =>
                        setMaterialForm((current) => ({ ...current, description: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Material Link (optional)
                      <input
                        value={materialForm.driveLink}
                        onChange={(event) =>
                          setMaterialForm((current) => ({ ...current, driveLink: event.target.value }))
                        }
                        placeholder="https://..."
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-iim-blue focus:ring-2 focus:ring-iim-blue/20"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Upload File (optional)
                      <input
                        type="file"
                        onChange={(event) =>
                          setMaterialForm((current) => ({ ...current, file: event.target.files?.[0] || null }))
                        }
                        className="mt-1 block w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-iim-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                      />
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={materialForm.isPublished}
                      onChange={(event) =>
                        setMaterialForm((current) => ({ ...current, isPublished: event.target.checked }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-iim-blue focus:ring-iim-blue/30"
                    />
                    Publish immediately
                  </label>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900"
                  >
                    <FileUp className="h-4 w-4" />
                    Add Material
                  </button>
                </form>
              </article>
            </section>

            <section className="space-y-5">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="heading-tight text-xl font-semibold text-slate-900">
                  Recent Announcements
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Manage active, scheduled, and expired notices.
                </p>

                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {announcements.length === 0 ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No announcements yet.
                    </p>
                  ) : (
                    announcements.map((announcement) => {
                      const statusBadge = announcementStatus(announcement)
                      return (
                        <div
                          key={announcement.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {announcement.title}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {announcement.posted_by} • {toLocalDateTimeLabel(announcement.created_at)}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${statusBadge.className}`}
                            >
                              {statusBadge.label}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">{announcement.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="h-3.5 w-3.5" />
                              Start: {toLocalDateTimeLabel(announcement.starts_at)}
                            </span>
                            <span>End: {toLocalDateTimeLabel(announcement.expires_at)}</span>
                          </div>
                          {announcement.attachment_url ? (
                            <a
                              href={announcement.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-iim-blue hover:underline"
                            >
                              Open attachment
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => deleteAnnouncement(announcement.id)}
                            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="heading-tight text-xl font-semibold text-slate-900">Ordered Materials</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Reorder for student display priority ({selectedCourse || 'No course selected'}).
                </p>

                <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {materialsLoading ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      Loading materials...
                    </p>
                  ) : null}

                  {!materialsLoading && materials.length === 0 ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No materials added for this course yet.
                    </p>
                  ) : null}

                  {!materialsLoading
                    ? materials.map((material, index) => (
                        <div
                          key={material.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{material.title}</p>
                              <p className="mt-1 text-xs text-slate-500">Order: {material.sort_order}</p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                material.is_published
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {material.is_published ? 'Published' : 'Draft'}
                            </span>
                          </div>
                          {material.description ? (
                            <p className="mt-2 text-sm text-slate-700">{material.description}</p>
                          ) : null}

                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            {material.drive_link ? (
                              <a
                                href={material.drive_link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-iim-blue hover:underline"
                              >
                                Link
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                            {material.file_url ? (
                              <a
                                href={material.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-iim-blue hover:underline"
                              >
                                File
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => moveMaterial(material.id, 'up')}
                              disabled={index === 0}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveMaterial(material.id, 'down')}
                              disabled={index === materials.length - 1}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                              Down
                            </button>
                            <button
                              type="button"
                              onClick={() => removeMaterial(material.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    : null}
                </div>
              </article>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs text-blue-900">
                <p className="font-semibold">AI behavior:</p>
                <p className="mt-1">
                  If `OPENAI_API_KEY` is set on backend, real AI output is used. Otherwise fallback templates/order
                  are applied so the panel still works.
                </p>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}
