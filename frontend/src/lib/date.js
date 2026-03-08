export function formatDateLabel(inputDate) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate)
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date)
}

export function formatDayTitle(inputDate) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate)
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatTimeLabel(value) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function startOfWeek(date = new Date()) {
  const target = new Date(date)
  const day = target.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  target.setDate(target.getDate() + diff)
  target.setHours(0, 0, 0, 0)
  return target
}

export function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function combineDateAndTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}`)
}
