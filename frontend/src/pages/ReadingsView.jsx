import { motion } from 'framer-motion'
import { BookOpenText, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'

function normalizeCourseDisplayName(value) {
  const cleaned = String(value || '')
    .replace(/\bsection\s*[AB]\b/gi, '')
    .replace(/\s+\b[AB]\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Course'
}

export default function ReadingsView() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function fetchReadings() {
      if (!user?.rollNumber) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const response = await api.get(`/api/v1/readings/${user.rollNumber}/`, {
          signal: controller.signal,
        })
        setCourses(Array.isArray(response.data) ? response.data : [])
      } catch (fetchError) {
        if (fetchError.name !== 'CanceledError') {
          setError('Unable to load course readings right now.')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchReadings()
    return () => controller.abort()
  }, [user?.rollNumber])

  const sortedCourses = useMemo(() => {
    return [...courses]
      .map((course) => ({
        ...course,
        name: normalizeCourseDisplayName(course?.name),
        materials: Array.isArray(course?.materials) ? course.materials : [],
      }))
      .sort((left, right) => String(left.code || '').localeCompare(String(right.code || '')))
  }, [courses])

  return (
    <section className="space-y-5">
      <div>
        <h2 className="heading-tight text-2xl font-bold text-slate-900">Course Readings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Open drive folders and curated files/links uploaded by CR/IPMO.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && sortedCourses.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-soft">
          No enrolled courses were found for this profile.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedCourses.map((course, index) => (
          <motion.article
            key={course.code}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: Math.min(index * 0.03, 0.2) }}
            className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {course.code}
                </p>
                <h3 className="mt-2 heading-tight text-lg font-semibold text-slate-900">{course.name}</h3>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
                <BookOpenText className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {course.drive_link ? (
                <a
                  href={course.drive_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-iim-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-900"
                >
                  Open Drive Folder
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
                >
                  Drive link not available
                </button>
              )}
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Materials</p>
              {course.materials.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No files or links uploaded yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {course.materials.map((material) => {
                    const link = material.drive_link || material.file_url
                    return (
                      <li
                        key={material.id}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        <p className="font-medium text-slate-900">{material.title}</p>
                        {material.description ? (
                          <p className="mt-1 text-xs text-slate-600">{material.description}</p>
                        ) : null}
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-iim-blue hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Open Material
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  )
}
