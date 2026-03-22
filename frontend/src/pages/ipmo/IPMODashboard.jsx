import {
  BookOpenCheck,
  FolderUp,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Save,
  Settings2,
  ShieldCheck,
  UserPlus2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import adminApi from '../../lib/adminApi'
import { clearAdminAuth, getStoredAdminUser } from '../../lib/storage'
import { cn } from '../../lib/cn'

const TABS = [
  { key: 'config', label: 'System Config', icon: Settings2 },
  { key: 'students', label: 'Student Directory', icon: Users },
  { key: 'courses', label: 'Course Manager', icon: BookOpenCheck },
  { key: 'grades', label: 'Grade Uploads', icon: FolderUp },
  { key: 'access', label: 'Access Control', icon: ShieldCheck },
]

const emptyStudent = {
  roll_number: '',
  name: '',
  section: 'A',
  email: '',
  date_of_birth: '',
  is_ipmo: false,
}

const emptyCourse = {
  code: '',
  name: '',
  credits: 0,
  drive_link: '',
}
const IPMO_API_TIMEOUT_MS = 90000
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractApiErrorMessage(error, fallbackMessage) {
  const detail = error?.response?.data?.detail
  if (detail) {
    return String(detail)
  }
  const status = error?.response?.status
  if (status) {
    return `Request failed with status ${status}.`
  }
  return fallbackMessage
}

function extractValidationError(error, fallbackMessage) {
  const detailMessage = extractApiErrorMessage(error, '')
  if (detailMessage) {
    return detailMessage
  }
  const payload = error?.response?.data
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const formatted = Object.entries(payload)
      .map(([field, value]) => {
        if (Array.isArray(value)) {
          return `${field}: ${value.join(', ')}`
        }
        return `${field}: ${String(value)}`
      })
      .join(' | ')
    if (formatted) {
      return formatted
    }
  }
  return fallbackMessage
}

async function requestWithRetry(requestFactory, options = {}) {
  const maxAttempts = options.attempts || 3
  const initialDelayMs = options.initialDelayMs || 1200
  let attempt = 0
  let lastError = null

  while (attempt < maxAttempts) {
    try {
      return await requestFactory()
    } catch (error) {
      lastError = error
      attempt += 1
      const status = error?.response?.status
      const code = String(error?.code || '')
      const networkLikeError = !error?.response || code === 'ECONNABORTED' || code === 'ERR_NETWORK'
      const retryable = networkLikeError || RETRYABLE_HTTP_STATUSES.has(status)
      if (!retryable || attempt >= maxAttempts) {
        throw error
      }
      await sleep(initialDelayMs * attempt)
    }
  }

  throw lastError
}

export default function IPMODashboard() {
  const adminUser = getStoredAdminUser()
  const [activeTab, setActiveTab] = useState('config')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [batches, setBatches] = useState([])
  const [selectedBatch, setSelectedBatch] = useState('')
  const [manualBatchCode, setManualBatchCode] = useState('')

  const [settingsForm, setSettingsForm] = useState({
    current_term_name: '',
    timetable_sheet_url: '',
    attendance_sheet_url: '',
    mess_menu_sheet_url: '',
    birthday_sheet_url: '',
  })
  const [students, setStudents] = useState([])
  const [courses, setCourses] = useState([])
  const [newStudent, setNewStudent] = useState(emptyStudent)
  const [newCourse, setNewCourse] = useState(emptyCourse)
  const [gradeUploadTerm, setGradeUploadTerm] = useState('')
  const [gradeFile, setGradeFile] = useState(null)
  const [uploadedGrades, setUploadedGrades] = useState([])
  const [adminAccounts, setAdminAccounts] = useState([])
  const [newAdminAccount, setNewAdminAccount] = useState({
    username: '',
    name: '',
    password: '',
    role: 'CR',
  })

  const sortedStudents = useMemo(
    () => [...students].sort((left, right) => left.roll_number.localeCompare(right.roll_number)),
    [students],
  )

  const sortedCourses = useMemo(
    () => [...courses].sort((left, right) => left.code.localeCompare(right.code)),
    [courses],
  )

  function updateStudentDraft(rollNumber, field, value) {
    setStudents((current) =>
      current.map((student) =>
        student.roll_number === rollNumber ? { ...student, [field]: value } : student,
      ),
    )
  }

  function updateCourseDraft(courseCode, field, value) {
    setCourses((current) =>
      current.map((course) => (course.code === courseCode ? { ...course, [field]: value } : course)),
    )
  }

  async function bootstrap(batchCode = selectedBatch) {
    setLoading(true)
    setError('')
    try {
      const settingsRes = await requestWithRetry(
        () =>
          adminApi.get('/api/v1/admin/settings/', {
            params: batchCode ? { batch_code: batchCode } : undefined,
            timeout: IPMO_API_TIMEOUT_MS,
          }),
        { attempts: 4, initialDelayMs: 1500 },
      )
      const resolvedBatch = settingsRes.data?.selected_batch_code || batchCode || ''
      const batchesPayload = Array.isArray(settingsRes.data?.batches) ? settingsRes.data.batches : []
      setBatches(batchesPayload)
      if (resolvedBatch && resolvedBatch !== selectedBatch) {
        setSelectedBatch(resolvedBatch)
      }

      setSettingsForm({
        current_term_name: settingsRes.data?.current_term_name || '',
        timetable_sheet_url: settingsRes.data?.timetable_sheet_url || '',
        attendance_sheet_url: settingsRes.data?.attendance_sheet_url || '',
        mess_menu_sheet_url: settingsRes.data?.mess_menu_sheet_url || '',
        birthday_sheet_url: settingsRes.data?.birthday_sheet_url || '',
      })

      const [studentsRes, coursesRes, accountsRes] = await Promise.allSettled([
        requestWithRetry(
          () =>
            adminApi.get('/api/v1/admin/students/', {
              params: resolvedBatch ? { batch_code: resolvedBatch } : undefined,
              timeout: IPMO_API_TIMEOUT_MS,
            }),
          { attempts: 3, initialDelayMs: 1200 },
        ),
        requestWithRetry(
          () =>
            adminApi.get('/api/v1/admin/courses/', {
              params: resolvedBatch ? { batch_code: resolvedBatch } : undefined,
              timeout: IPMO_API_TIMEOUT_MS,
            }),
          { attempts: 3, initialDelayMs: 1200 },
        ),
        requestWithRetry(
          () =>
            adminApi.get('/api/v1/admin/accounts/', {
              timeout: IPMO_API_TIMEOUT_MS,
            }),
          { attempts: 3, initialDelayMs: 1200 },
        ),
      ])

      const loadErrors = []
      if (studentsRes.status === 'fulfilled') {
        setStudents(Array.isArray(studentsRes.value.data) ? studentsRes.value.data : [])
      } else {
        setStudents([])
        loadErrors.push(`students: ${extractApiErrorMessage(studentsRes.reason, 'unavailable')}`)
      }

      if (coursesRes.status === 'fulfilled') {
        setCourses(Array.isArray(coursesRes.value.data) ? coursesRes.value.data : [])
      } else {
        setCourses([])
        loadErrors.push(`courses: ${extractApiErrorMessage(coursesRes.reason, 'unavailable')}`)
      }

      if (accountsRes.status === 'fulfilled') {
        setAdminAccounts(Array.isArray(accountsRes.value.data) ? accountsRes.value.data : [])
      } else {
        setAdminAccounts([])
        loadErrors.push(`access: ${extractApiErrorMessage(accountsRes.reason, 'unavailable')}`)
      }

      if (loadErrors.length > 0) {
        setError(`IPMO config loaded, but some data failed (${loadErrors.join(' | ')}). Retry in 30s.`)
      }
    } catch (bootstrapError) {
      setError(extractApiErrorMessage(bootstrapError, 'Unable to load IPMO dashboard data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveSettingsAndSync() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await adminApi.put('/api/v1/admin/settings/', {
        ...settingsForm,
        batch_code: selectedBatch,
      })
      try {
        const syncResponse = await adminApi.post(
          '/api/v1/admin/run-sync/',
          { mode: 'sync', batch_code: selectedBatch },
          { timeout: 180000 },
        )
        const queued = syncResponse?.status === 202 || syncResponse?.data?.status === 'queued'
        if (queued) {
          setSuccess('Settings saved. Sync started in background — check back in a few minutes.')
        } else {
          setSuccess('Settings saved and sync completed successfully.')
        }
      } catch (syncError) {
        const syncMessage =
          syncError?.response?.data?.detail || 'Sync failed after saving settings.'
        setSuccess(`Settings saved, but sync failed: ${syncMessage}`)
      }
    } catch (saveError) {
      const errorData = saveError?.response?.data
      if (errorData && typeof errorData === 'object' && !Array.isArray(errorData)) {
        const fieldErrors = Object.entries(errorData)
          .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
          .join(' | ')
        setError(fieldErrors || 'Failed to save settings.')
      } else {
        setError(saveError?.response?.data?.detail || 'Failed to save settings.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function createStudent(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.post('/api/v1/admin/students/', {
        ...newStudent,
        batch_code: selectedBatch,
        roll_number: newStudent.roll_number.trim().toUpperCase(),
      })
      setStudents((current) => [response.data, ...current])
      setNewStudent(emptyStudent)
      setSuccess('Student created.')
    } catch (createError) {
      setError(extractValidationError(createError, 'Unable to create student.'))
    }
  }

  async function updateStudent(rollNumber, patch) {
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.put(`/api/v1/admin/students/${rollNumber}/`, patch, {
        params: selectedBatch ? { batch_code: selectedBatch } : undefined,
      })
      setStudents((current) =>
        current.map((student) => (student.roll_number === rollNumber ? response.data : student)),
      )
      setSuccess('Student updated.')
    } catch (updateError) {
      setError(extractValidationError(updateError, 'Unable to update student.'))
    }
  }

  async function deleteStudent(rollNumber) {
    setError('')
    setSuccess('')
    try {
      await adminApi.delete(`/api/v1/admin/students/${rollNumber}/`, {
        params: selectedBatch ? { batch_code: selectedBatch } : undefined,
      })
      setStudents((current) => current.filter((student) => student.roll_number !== rollNumber))
      setSuccess('Student removed.')
    } catch (deleteError) {
      setError(extractValidationError(deleteError, 'Unable to remove student.'))
    }
  }

  async function changeStudentRollNumber(rollNumber) {
    const nextRollNumber = window
      .prompt('Enter new roll number', rollNumber)
      ?.trim()
      .toUpperCase()

    if (!nextRollNumber || nextRollNumber === rollNumber) {
      return
    }

    setError('')
    setSuccess('')
    try {
      const response = await adminApi.put(`/api/v1/admin/students/${rollNumber}/`, {
        roll_number: nextRollNumber,
      }, {
        params: selectedBatch ? { batch_code: selectedBatch } : undefined,
      })
      setStudents((current) =>
        current.map((student) => (student.roll_number === rollNumber ? response.data : student)),
      )
      setSuccess('Roll number updated.')
    } catch (updateError) {
      setError(extractValidationError(updateError, 'Unable to update roll number.'))
    }
  }

  async function createCourse(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.post('/api/v1/admin/courses/', {
        ...newCourse,
        code: newCourse.code.trim().toUpperCase(),
        credits: Number(newCourse.credits || 0),
      })
      setCourses((current) => [response.data, ...current])
      setNewCourse(emptyCourse)
      setSuccess('Course created.')
    } catch (createError) {
      setError(extractValidationError(createError, 'Unable to create course.'))
    }
  }

  async function updateCourse(courseCode, patch) {
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.put(`/api/v1/admin/courses/${courseCode}/`, patch)
      setCourses((current) =>
        current.map((course) => (course.code === courseCode ? response.data : course)),
      )
      setSuccess('Course updated.')
    } catch (updateError) {
      setError(extractValidationError(updateError, 'Unable to update course.'))
    }
  }

  async function deleteCourse(courseCode) {
    setError('')
    setSuccess('')
    try {
      await adminApi.delete(`/api/v1/admin/courses/${courseCode}/`)
      setCourses((current) => current.filter((course) => course.code !== courseCode))
      setSuccess('Course removed.')
    } catch (deleteError) {
      setError(extractValidationError(deleteError, 'Unable to remove course.'))
    }
  }

  async function uploadGradeDocument(event) {
    event.preventDefault()
    if (!gradeFile) {
      setError('Please select a PDF before uploading.')
      return
    }

    setError('')
    setSuccess('')
    try {
      const payload = new FormData()
      payload.append('batch_code', selectedBatch)
      payload.append('term_name', gradeUploadTerm)
      payload.append('document', gradeFile)
      const response = await adminApi.post('/api/v1/admin/grades/', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUploadedGrades((current) => [response.data, ...current])
      setGradeUploadTerm('')
      setGradeFile(null)
      setSuccess('Grade document uploaded successfully.')
    } catch (uploadError) {
      setError(uploadError?.response?.data?.detail || 'Unable to upload grade document.')
    }
  }

  async function createAdminAccount(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.post('/api/v1/admin/accounts/', {
        username: newAdminAccount.username.trim(),
        name: newAdminAccount.name.trim(),
        password: newAdminAccount.password,
        role: newAdminAccount.role,
      })
      setAdminAccounts((current) => [response.data, ...current])
      setNewAdminAccount({
        username: '',
        name: '',
        password: '',
        role: 'CR',
      })
      setSuccess('Admin access created.')
    } catch (createError) {
      setError(createError?.response?.data?.detail || 'Unable to create admin access.')
    }
  }

  async function updateAdminAccount(accountId, patch) {
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.patch(`/api/v1/admin/accounts/${accountId}/`, patch)
      setAdminAccounts((current) =>
        current.map((account) => (account.id === accountId ? response.data : account)),
      )
      setSuccess('Access updated.')
    } catch (updateError) {
      setError(updateError?.response?.data?.detail || 'Unable to update access.')
    }
  }

  async function deactivateAdminAccount(accountId) {
    setError('')
    setSuccess('')
    try {
      await adminApi.delete(`/api/v1/admin/accounts/${accountId}/`)
      setAdminAccounts((current) => current.filter((account) => account.id !== accountId))
      setSuccess('Access revoked.')
    } catch (deleteError) {
      setError(deleteError?.response?.data?.detail || 'Unable to revoke access.')
    }
  }

  async function resetAdminPassword(accountId, username) {
    const nextPassword = window.prompt(`Enter new password for ${username}`)
    if (!nextPassword) {
      return
    }
    await updateAdminAccount(accountId, { password: nextPassword })
  }

  function logout() {
    clearAdminAuth()
    window.location.href = '/dashboard'
  }

  async function handleBatchChange(nextBatchCode) {
    setSelectedBatch(nextBatchCode)
    await bootstrap(nextBatchCode)
  }

  async function addOrSwitchBatch() {
    const nextBatchCode = manualBatchCode.trim().toUpperCase()
    if (!nextBatchCode) {
      return
    }
    setSelectedBatch(nextBatchCode)
    setManualBatchCode('')
    await bootstrap(nextBatchCode)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-amber-300">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 p-4 md:flex-row md:p-6">
        <aside className="w-full flex-shrink-0 rounded-3xl border border-slate-800 bg-slate-900 p-5 md:w-72">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-300">IPMO Console</p>
            <h1 className="mt-2 text-2xl font-semibold text-amber-100">Admin Portal</h1>
            <p className="mt-1 text-xs text-slate-400">{adminUser?.name || adminUser?.username}</p>
          </div>

          <nav className="flex flex-wrap gap-2 md:flex-col md:space-y-2">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition md:w-full md:gap-3',
                  activeTab === key
                    ? 'bg-amber-400/20 text-amber-200'
                    : 'text-slate-300 hover:bg-slate-800',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={logout}
            className="mt-8 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Exit Portal
          </button>
        </aside>

        <main className="flex-1 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          {error ? (
            <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mb-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </div>
          ) : null}

          {activeTab === 'config' ? (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-amber-100">System Configuration</h2>
              <label className="block text-sm text-slate-300">
                Batch
                <select
                  value={selectedBatch}
                  onChange={(event) => handleBatchChange(event.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                >
                  {batches.map((batch) => (
                    <option key={batch.code} value={batch.code}>
                      {batch.display_name || batch.name || batch.code}
                      {batch.ipm_year ? ` (${batch.ipm_year})` : ''}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={manualBatchCode}
                    onChange={(event) => setManualBatchCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addOrSwitchBatch()
                      }
                    }}
                    placeholder="Type batch code (e.g. 2023 or IPM03)"
                    className="h-11 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                  />
                  <button
                    type="button"
                    onClick={addOrSwitchBatch}
                    className="h-11 rounded-xl border border-amber-300/30 px-4 text-sm font-medium text-amber-200 transition hover:bg-amber-300/10"
                  >
                    Use Batch
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  You can switch using year format (2023) or legacy format (IPM03).
                </p>
              </label>
              <label className="block text-sm text-slate-300">
                Current Term Name
                <input
                  type="text"
                  value={settingsForm.current_term_name}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, current_term_name: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Timetable Sheet URL or ID
                <input
                  type="url"
                  value={settingsForm.timetable_sheet_url}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, timetable_sheet_url: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Attendance Sheet URL or ID
                <input
                  type="url"
                  value={settingsForm.attendance_sheet_url}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, attendance_sheet_url: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Mess Menu Sheet URL or ID
                <input
                  type="url"
                  value={settingsForm.mess_menu_sheet_url}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, mess_menu_sheet_url: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Birthday Sheet URL or ID
                <input
                  type="url"
                  value={settingsForm.birthday_sheet_url}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, birthday_sheet_url: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                />
              </label>
              <button
                type="button"
                onClick={saveSettingsAndSync}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-amber-300 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving & Syncing...' : 'Save & Trigger Sync'}
              </button>
            </section>
          ) : null}

          {activeTab === 'students' ? (
            <section className="space-y-6">
              <h2 className="text-xl font-semibold text-amber-100">Student Directory</h2>
              <form onSubmit={createStudent} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-6">
                <input
                  placeholder="Roll Number"
                  value={newStudent.roll_number}
                  onChange={(event) => setNewStudent((current) => ({ ...current, roll_number: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  placeholder="Name"
                  value={newStudent.name}
                  onChange={(event) => setNewStudent((current) => ({ ...current, name: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  placeholder="Email"
                  value={newStudent.email}
                  onChange={(event) => setNewStudent((current) => ({ ...current, email: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <select
                  value={newStudent.section}
                  onChange={(event) => setNewStudent((current) => ({ ...current, section: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={newStudent.is_ipmo}
                    onChange={(event) => setNewStudent((current) => ({ ...current, is_ipmo: event.target.checked }))}
                  />
                  IPMO
                </label>
                <button type="submit" className="rounded-lg bg-amber-400 px-3 text-sm font-semibold text-slate-900">
                  Add
                </button>
              </form>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="bg-slate-950 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Roll</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Section</th>
                      <th className="px-3 py-2 text-left">IPMO</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {sortedStudents.map((student) => (
                      <tr key={student.roll_number}>
                        <td className="px-3 py-2 font-medium">{student.roll_number}</td>
                        <td className="px-3 py-2">
                          <input
                            value={student.name || ''}
                            onChange={(event) =>
                              updateStudentDraft(student.roll_number, 'name', event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-2"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={student.email || ''}
                            onChange={(event) =>
                              updateStudentDraft(student.roll_number, 'email', event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-2"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={student.section || 'A'}
                            onChange={(event) =>
                              updateStudentDraft(student.roll_number, 'section', event.target.value)
                            }
                            className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-2"
                          >
                            <option value="A">A</option>
                            <option value="B">B</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(student.is_ipmo)}
                              onChange={(event) =>
                                updateStudentDraft(student.roll_number, 'is_ipmo', event.target.checked)
                              }
                            />
                            <span>{student.is_ipmo ? 'Yes' : 'No'}</span>
                          </label>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateStudent(student.roll_number, {
                                  name: student.name,
                                  email: student.email,
                                  section: student.section,
                                  is_ipmo: student.is_ipmo,
                                })
                              }
                              className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => changeStudentRollNumber(student.roll_number)}
                              className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
                            >
                              Roll
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteStudent(student.roll_number)}
                              className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {activeTab === 'courses' ? (
            <section className="space-y-6">
              <h2 className="text-xl font-semibold text-amber-100">Course Manager</h2>
              <form onSubmit={createCourse} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-5">
                <input
                  placeholder="Code"
                  value={newCourse.code}
                  onChange={(event) => setNewCourse((current) => ({ ...current, code: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  placeholder="Name"
                  value={newCourse.name}
                  onChange={(event) => setNewCourse((current) => ({ ...current, name: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  type="number"
                  placeholder="Credits"
                  value={newCourse.credits}
                  onChange={(event) => setNewCourse((current) => ({ ...current, credits: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  placeholder="Drive Link"
                  value={newCourse.drive_link}
                  onChange={(event) => setNewCourse((current) => ({ ...current, drive_link: event.target.value }))}
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <button type="submit" className="rounded-lg bg-amber-400 px-3 text-sm font-semibold text-slate-900">
                  Add
                </button>
              </form>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="bg-slate-950 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Credits</th>
                      <th className="px-3 py-2 text-left">Drive Link</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {sortedCourses.map((course) => (
                      <tr key={course.code}>
                        <td className="px-3 py-2 font-medium">{course.code}</td>
                        <td className="px-3 py-2">
                          <input
                            value={course.name || ''}
                            onChange={(event) =>
                              updateCourseDraft(course.code, 'name', event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-2"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={course.credits ?? 0}
                            onChange={(event) =>
                              updateCourseDraft(course.code, 'credits', event.target.value)
                            }
                            className="h-9 w-24 rounded-lg border border-slate-700 bg-slate-900 px-2"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={course.drive_link || ''}
                            onChange={(event) =>
                              updateCourseDraft(course.code, 'drive_link', event.target.value)
                            }
                            className="h-9 w-full min-w-[220px] rounded-lg border border-slate-700 bg-slate-900 px-2"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateCourse(course.code, {
                                  credits: Number(course.credits || 0),
                                  drive_link: course.drive_link || '',
                                  name: course.name,
                                })
                              }
                              className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCourse(course.code)}
                              className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {activeTab === 'grades' ? (
            <section className="space-y-6">
              <h2 className="text-xl font-semibold text-amber-100">Grade Uploads</h2>
              <form
                onSubmit={uploadGradeDocument}
                className="space-y-4 rounded-2xl border border-dashed border-amber-300/40 bg-slate-950 p-6"
              >
                <label className="block text-sm text-slate-300">
                  Term Name
                  <input
                    type="text"
                    value={gradeUploadTerm}
                    onChange={(event) => setGradeUploadTerm(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100"
                  />
                </label>
                <label className="flex h-36 cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-sm text-slate-300">
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(event) => setGradeFile(event.target.files?.[0] || null)}
                  />
                  <span>{gradeFile ? gradeFile.name : 'Drop PDF here or click to select'}</span>
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900"
                >
                  <GraduationCap className="h-4 w-4" />
                  Upload Grade PDF
                </button>
              </form>

              {uploadedGrades.length > 0 ? (
                <div className="rounded-2xl border border-slate-800">
                  <table className="min-w-full divide-y divide-slate-800 text-sm">
                    <thead className="bg-slate-950 text-slate-300">
                      <tr>
                        <th className="px-3 py-2 text-left">Term</th>
                        <th className="px-3 py-2 text-left">File</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {uploadedGrades.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2">{item.term_name}</td>
                          <td className="px-3 py-2">{item.document}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeTab === 'access' ? (
            <section className="space-y-6">
              <h2 className="text-xl font-semibold text-amber-100">CR/IPMO Access Control</h2>
              <p className="text-sm text-slate-400">
                Create credentials, assign role, reset passwords, and revoke access.
              </p>

              <form
                onSubmit={createAdminAccount}
                className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-5"
              >
                <input
                  placeholder="Username"
                  value={newAdminAccount.username}
                  onChange={(event) =>
                    setNewAdminAccount((current) => ({ ...current, username: event.target.value }))
                  }
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                  required
                />
                <input
                  placeholder="Full name (optional)"
                  value={newAdminAccount.name}
                  onChange={(event) =>
                    setNewAdminAccount((current) => ({ ...current, name: event.target.value }))
                  }
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                />
                <input
                  type="text"
                  placeholder="Initial password"
                  value={newAdminAccount.password}
                  onChange={(event) =>
                    setNewAdminAccount((current) => ({ ...current, password: event.target.value }))
                  }
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                  required
                />
                <select
                  value={newAdminAccount.role}
                  onChange={(event) =>
                    setNewAdminAccount((current) => ({ ...current, role: event.target.value }))
                  }
                  className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
                >
                  <option value="CR">CR</option>
                  <option value="IPMO">IPMO</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 text-sm font-semibold text-slate-900"
                >
                  <UserPlus2 className="h-4 w-4" />
                  Create Access
                </button>
              </form>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="bg-slate-950 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Username</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Role</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Last Login</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {adminAccounts.map((account) => (
                      <tr key={account.id}>
                        <td className="px-3 py-2 font-medium">{account.username}</td>
                        <td className="px-3 py-2">{account.name || '-'}</td>
                        <td className="px-3 py-2">
                          <select
                            value={account.role}
                            onChange={(event) =>
                              updateAdminAccount(account.id, { role: event.target.value })
                            }
                            className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-2"
                          >
                            <option value="CR">CR</option>
                            <option value="IPMO">IPMO</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateAdminAccount(account.id, { is_active: !Boolean(account.is_active) })
                            }
                            className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                              account.is_active
                                ? 'bg-emerald-500/20 text-emerald-200'
                                : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {account.is_active ? 'Active' : 'Disabled'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {account.last_login ? new Date(account.last_login).toLocaleString() : 'Never'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => resetAdminPassword(account.id, account.username)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Reset Password
                            </button>
                            <button
                              type="button"
                              onClick={() => deactivateAdminAccount(account.id)}
                              className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-200"
                            >
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  )
}
