import { BarChart3, CheckCircle2, Vote } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'
import { formatDateLabel } from '../lib/date'

export default function PollsView() {
  const { user } = useAuth()
  const [polls, setPolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [votingPollId, setVotingPollId] = useState(null)

  async function fetchPolls() {
    if (!user?.rollNumber) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/api/v1/polls/?roll_number=${user.rollNumber}`)
      setPolls(Array.isArray(response.data) ? response.data : [])
    } catch (fetchError) {
      setError(fetchError?.response?.data?.detail || 'Unable to load active polls right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPolls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.rollNumber])

  async function vote(pollId, optionId) {
    if (!user?.rollNumber) {
      return
    }
    setVotingPollId(pollId)
    setError('')
    try {
      const response = await api.post(`/api/v1/polls/${pollId}/vote/`, {
        roll_number: user.rollNumber,
        option_id: optionId,
      })
      const updated = response.data || null
      setPolls((current) =>
        current.map((poll) => (poll.id === pollId ? { ...poll, ...updated } : poll)),
      )
    } catch (voteError) {
      setError(voteError?.response?.data?.detail || 'Unable to submit your vote.')
    } finally {
      setVotingPollId(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-iim-blue">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="heading-tight text-2xl font-semibold text-slate-900">Polls</h1>
            <p className="text-sm text-slate-500">
              Vote on live polls targeted to your batch, section, and enrolled courses.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-3xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && polls.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-soft">
          No active polls for you right now.
        </div>
      ) : null}

      {!loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {polls.map((poll) => (
            <article key={poll.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="heading-tight text-lg font-semibold text-slate-900">{poll.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {poll.created_by} • {formatDateLabel(poll.created_at)}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {poll.target_type.replace('_', ' ')}
                </span>
              </div>

              {poll.description ? (
                <p className="mt-3 text-sm text-slate-700">{poll.description}</p>
              ) : null}

              <div className="mt-4 space-y-2">
                {poll.options.map((option) => {
                  const isSelected = poll.student_vote_option_id === option.id
                  const showResults = Boolean(poll.has_voted)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={poll.has_voted || votingPollId === poll.id}
                      onClick={() => vote(poll.id, option.id)}
                      className={cn(
                        'w-full rounded-2xl border px-3 py-2 text-left transition',
                        poll.has_voted
                          ? 'cursor-default border-slate-200 bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-iim-blue/50 hover:bg-blue-50/40',
                        isSelected && 'border-emerald-200 bg-emerald-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-slate-800">{option.text}</span>
                        {isSelected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                      </div>
                      {showResults ? (
                        <div className="mt-2">
                          <div className="h-2 rounded-full bg-slate-200">
                            <div
                              className={cn('h-2 rounded-full', isSelected ? 'bg-emerald-500' : 'bg-iim-blue')}
                              style={{ width: `${Math.max(0, Math.min(100, option.percentage || 0))}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {option.percentage ?? 0}% ({option.vote_count ?? 0} votes)
                          </p>
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {!poll.has_voted ? (
                <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-iim-blue">
                  <Vote className="h-3.5 w-3.5" />
                  Vote to unlock live percentages
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Total votes: {poll.total_votes ?? 0}</p>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
