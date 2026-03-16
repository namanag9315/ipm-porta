import { BarChart3, BellRing, CheckCircle2, Vote } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { cn } from '../lib/cn'
import { formatDateLabel } from '../lib/date'

export default function NoticeboardView() {
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [polls, setPolls] = useState([])
  const [votingPollId, setVotingPollId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError('')
      try {
        const results = await Promise.allSettled([
          api.get('/api/v1/dashboard-extras/'),
          user?.rollNumber ? api.get(`/api/v1/polls/?roll_number=${user.rollNumber}`) : Promise.resolve({ data: [] }),
        ])
        const extrasResponse = results[0]?.status === 'fulfilled' ? results[0].value : null
        const pollsResponse = results[1]?.status === 'fulfilled' ? results[1].value : null

        setAnnouncements(
          Array.isArray(extrasResponse?.data?.recent_announcements) ? extrasResponse.data.recent_announcements : [],
        )
        setPolls(Array.isArray(pollsResponse?.data) ? pollsResponse.data : [])

        const hadFailures = results.some((result) => result.status === 'rejected')
        if (hadFailures) {
          setError('Some noticeboard data could not be loaded yet. Please refresh in a moment.')
        }
      } catch (fetchError) {
        setError(fetchError?.response?.data?.detail || 'Unable to load noticeboard.')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
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
      setPolls((current) =>
        current.map((poll) => (poll.id === pollId ? { ...poll, ...(response.data || {}) } : poll)),
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
            <BellRing className="h-6 w-6" />
          </div>
          <div>
            <h1 className="heading-tight text-2xl font-semibold text-slate-900">Noticeboard</h1>
            <p className="text-sm text-slate-500">Latest notices from CRs and IPMO.</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-3xl bg-white shadow-soft" />
          ))}
        </div>
      ) : null}

      {!loading && announcements.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-soft">
          No announcements available.
        </div>
      ) : null}

      {!loading ? (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="heading-tight text-lg font-semibold text-slate-900">{announcement.title}</h2>
              <p className="mt-2 text-sm text-slate-700">{announcement.content}</p>
              <p className="mt-3 text-xs text-slate-500">
                {announcement.posted_by} • {formatDateLabel(announcement.created_at)}
              </p>
            </article>
          ))}
        </div>
      ) : null}

      {!loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-iim-blue" />
            <h2 className="heading-tight text-lg font-semibold text-slate-900">Active Polls</h2>
          </div>
          {polls.length === 0 ? (
            <p className="text-sm text-slate-500">No active polls right now.</p>
          ) : (
            <div className="space-y-3">
              {polls.map((poll) => (
                <article key={poll.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">{poll.title}</p>
                  {poll.description ? (
                    <p className="mt-1 text-sm text-slate-700">{poll.description}</p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {poll.options.map((option) => {
                      const selected = poll.student_vote_option_id === option.id
                      const showResult = Boolean(poll.has_voted)
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={poll.has_voted || votingPollId === poll.id}
                          onClick={() => vote(poll.id, option.id)}
                          className={cn(
                            'w-full rounded-xl border px-3 py-2 text-left',
                            selected ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span>{option.text}</span>
                            {selected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                          </div>
                          {showResult ? (
                            <div className="mt-2">
                              <div className="h-2 rounded-full bg-slate-200">
                                <div
                                  className={cn('h-2 rounded-full', selected ? 'bg-emerald-500' : 'bg-iim-blue')}
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
                    <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-iim-blue">
                      <Vote className="h-3.5 w-3.5" />
                      Vote to reveal result percentages
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
