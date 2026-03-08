import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'

const LOAN_CALCULATOR_URL =
  import.meta.env.VITE_LOAN_CALCULATOR_URL || 'https://student-loan-oigt.vercel.app/'
const HAS_VALID_CALCULATOR_URL = /^https?:\/\//.test(LOAN_CALCULATOR_URL)

export default function LoanCalculator() {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="heading-tight text-2xl font-bold text-slate-900">Loan Calculator</h2>
        <p className="mt-1 text-sm text-slate-500">
          Estimate EMIs and repayment schedules directly within the portal.
        </p>
      </div>

      {!HAS_VALID_CALCULATOR_URL ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Set <code>VITE_LOAN_CALCULATOR_URL</code> in your frontend env to load the live calculator.
        </div>
      ) : null}

      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-soft"
      >
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-sm font-medium text-slate-700">Embedded Calculator</p>
          {HAS_VALID_CALCULATOR_URL ? (
            <a
              href={LOAN_CALCULATOR_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-iim-blue hover:text-iim-gold"
            >
              Open in new tab <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>

        <div className="h-[72vh] min-h-[560px] overflow-hidden rounded-xl bg-slate-100">
          <iframe
            src={LOAN_CALCULATOR_URL}
            title="Loan Calculator"
            className="h-full w-full rounded-xl border-0"
            loading="lazy"
          />
        </div>
      </motion.article>
    </section>
  )
}
