import {
  AlertCircle,
  GraduationCap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import iimIndoreWatermark from '../assets/iim indore image.webp'
import FloatingLabelInput from '../components/ui/FloatingLabelInput'
import { cn } from '../lib/cn'
import { useAuth } from '../hooks/useAuth'

const CAMPUS_HERO_IMAGE_URL = iimIndoreWatermark
const IIM_INDORE_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/a5/IIM_Indore_Logo.svg'
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || ''
const RECAPTCHA_ACTION = import.meta.env.VITE_RECAPTCHA_ACTION || 'student_login'

async function requestRecaptchaToken(siteKey, action) {
  if (!window.grecaptcha || typeof window.grecaptcha.execute !== 'function') {
    throw new Error('reCAPTCHA is not ready yet.')
  }

  return new Promise((resolve, reject) => {
    try {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(siteKey, { action })
          resolve(token || '')
        } catch (error) {
          reject(error)
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loading } = useAuth()

  const [rollNumber, setRollNumber] = useState('')
  const [password, setPassword] = useState('')
  const [recaptchaReady, setRecaptchaReady] = useState(false)
  const [error, setError] = useState('')

  const fromPath = location.state?.from?.pathname || '/dashboard'
  const recaptchaEnabled = Boolean(RECAPTCHA_SITE_KEY)

  useEffect(() => {
    if (!recaptchaEnabled) {
      setRecaptchaReady(false)
      return undefined
    }

    let cancelled = false
    const scriptId = 'google-recaptcha-v3'

    const markReady = () => {
      if (cancelled) {
        return
      }
      if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
        window.grecaptcha.ready(() => {
          if (!cancelled) {
            setRecaptchaReady(true)
          }
        })
      }
    }

    const markError = () => {
      if (!cancelled) {
        setRecaptchaReady(false)
      }
    }

    const existingScript = document.getElementById(scriptId)
    if (existingScript) {
      if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
        markReady()
      } else {
        existingScript.addEventListener('load', markReady)
        existingScript.addEventListener('error', markError)
      }
      return () => {
        cancelled = true
        existingScript.removeEventListener('load', markReady)
        existingScript.removeEventListener('error', markError)
      }
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`
    script.async = true
    script.defer = true
    script.addEventListener('load', markReady)
    script.addEventListener('error', markError)
    document.head.appendChild(script)

    return () => {
      cancelled = true
      script.removeEventListener('load', markReady)
      script.removeEventListener('error', markError)
    }
  }, [recaptchaEnabled])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    let captchaToken = ''
    if (recaptchaEnabled) {
      if (!recaptchaReady) {
        setError('Security check is still loading. Please wait a moment and retry.')
        return
      }

      try {
        captchaToken = await requestRecaptchaToken(RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION)
      } catch {
        setError('Unable to run captcha verification. Please refresh and try again.')
        return
      }

      if (!captchaToken) {
        setError('Captcha verification failed to generate a token. Please retry.')
        return
      }
    }

    try {
      await login({
        rollNumber: rollNumber.trim().toUpperCase(),
        password,
        captchaToken,
      })
      navigate(fromPath, { replace: true })
    } catch (submitError) {
      const status = submitError?.response?.status
      const isRetryable = !submitError?.response || status >= 500
      const message =
        submitError?.response?.data?.detail ||
        submitError?.response?.data?.message ||
        (isRetryable
          ? 'The server is waking up. Please wait 20-30 seconds and try again.'
          : 'Unable to sign in. Please verify your roll number and password.')
      setError(message)
    }
  }

  return (
    <div className="relative grid min-h-screen overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
      <img
        src={CAMPUS_HERO_IMAGE_URL}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-iim-blue/40 via-transparent to-white/70" />

      <section className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-gradient-to-t from-iim-blue/90 via-iim-blue/45 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_52%)]" />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute inset-x-10 bottom-10"
        >
          <div className="glass rounded-3xl p-8 text-white">
            <div className="mb-6 inline-flex items-center gap-3 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em]">
              <GraduationCap className="h-4 w-4" />
              IIM Indore IPM Portal
            </div>
            <p className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-white">
              &ldquo;Education at IIM Indore is about building rigorous thinkers, principled
              leaders, and resilient professionals.&rdquo;
            </p>
            <p className="mt-4 text-sm text-white/85">Institute Vision Statement</p>
          </div>
        </motion.div>
      </section>

      <section className="relative flex items-center justify-center bg-white/85 px-6 py-10 sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(30,58,138,0.06),transparent_55%)]" />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="mb-6 flex justify-center">
            <img
              src={IIM_INDORE_LOGO_URL}
              alt="IIM Indore logo"
              className="h-16 w-auto sm:h-20"
              loading="eager"
            />
          </div>

          <div className="mb-10">
            <h1 className="heading-tight text-3xl font-bold text-slate-900">Welcome Back</h1>
            <p className="mt-3 text-sm text-slate-500">
              Sign in to access your timetable, attendance insights, and mess updates.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
            <FloatingLabelInput
              id="roll-number"
              label="Roll Number"
              name="username"
              autoComplete="username"
              value={rollNumber}
              onChange={(event) => setRollNumber(event.target.value)}
              required
            />

            <FloatingLabelInput
              id="password"
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {recaptchaEnabled ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-xs text-slate-600">
                {recaptchaReady ? (
                  <span>Protected by Google reCAPTCHA v3.</span>
                ) : (
                  <span>Loading reCAPTCHA security check...</span>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                reCAPTCHA is not configured for this environment yet.
              </div>
            )}

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            <motion.button
              type="submit"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={loading || (recaptchaEnabled && !recaptchaReady)}
              className={cn(
                'h-12 w-full rounded-2xl bg-iim-blue text-sm font-semibold text-white transition-all duration-300',
                'shadow-[0_10px_25px_rgba(30,58,138,0.25)] hover:shadow-glow-gold',
                'disabled:cursor-not-allowed disabled:opacity-70',
              )}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </motion.button>

            <div className="pt-1 text-center">
              <Link
                to="/admin-portal"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:text-iim-blue"
              >
                CR / IPMO Admin Portal
              </Link>
            </div>
          </form>
        </motion.div>
      </section>
    </div>
  )
}
