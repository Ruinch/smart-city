import type { LiveEvent, WalkRequest } from '../shared/types'

type EventCategory = LiveEvent['category']

const EVENT_WORDS = /афиш|мероприят|событи|event|what.s on|іс.шара|шаралар|концерт|concert|выставк|экспозиц|exhibition|көрме|фестивал|festival|спорт|матч|хокке|футбол|марафон|sport|match|вечеринк|вечерн.*мероприят|nightlife|party|клуб|танц|nightclub|dance|кеш|ойын/u

/** Explicit wording turns on events even when the visitor has not used the UI filter. */
export function wantsLiveEvents(request: WalkRequest): boolean {
  return request.scope !== 'day_trip' && (request.includeEvents === true
    || EVENT_WORDS.test(request.text.normalize('NFKC').toLocaleLowerCase('ru')))
}

function requestedCategories(text: string): Set<EventCategory> {
  const value = text.normalize('NFKC').toLocaleLowerCase('ru')
  const categories = new Set<EventCategory>()
  if (/выставк|экспозиц|exhibition|expo|көрме/u.test(value)) categories.add('exhibition')
  if (/концерт|concert|жанды музыка|live music/u.test(value)) categories.add('concert')
  if (/фестивал|festival|ярмарк|fest|жәрмеңк/u.test(value)) categories.add('festival')
  if (/спорт|матч|хокке|футбол|баскетбол|марафон|sport|match|hockey|football|game|ойын/u.test(value)) categories.add('sport')
  if (/вечеринк|ночн|вечерн.*мероприят|nightlife|party|клуб|танц|би кеш|кешкі/u.test(value)) categories.add('evening')
  return categories
}

function requestedDay(text: string, now: Date): string | null {
  const value = text.normalize('NFKC').toLocaleLowerCase('ru')
  const shift = /завтра|\btomorrow\b|ертең/u.test(value) ? 1
    : /сегодня|\btoday\b|бүгін/u.test(value) ? 0 : null
  return shift === null ? null : localDate(new Date(now.getTime() + shift * 86_400_000))
}

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function dateKey(value: string): string | null {
  if (validDateOnly(value)) return value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const instant = new Date(value)
  return Number.isFinite(instant.getTime()) ? localDate(instant) : null
}

function isRelevantDate(event: LiveEvent, now: Date, horizonDate: string): boolean {
  const today = localDate(now)
  const start = dateKey(event.startsAt)
  const end = event.endsAt ? dateKey(event.endsAt) : start
  if (!start || !end || end < start || end < today || start > horizonDate) return false
  if (start === today && !event.endsAt && event.startsAt.includes('T')
    && new Date(event.startsAt).getTime() < now.getTime()) return false
  if (event.endsAt?.includes('T') && new Date(event.endsAt).getTime() < now.getTime()) return false
  return true
}

/** Events remain separate from route stops until exact time and venue can be checked. */
export function selectLiveEvents(events: LiveEvent[], request: WalkRequest, now = new Date(),
  wheelchairTaggedIds: ReadonlySet<string> = new Set()): LiveEvent[] {
  if (!wantsLiveEvents(request)) return []
  const categories = requestedCategories(request.text)
  const day = requestedDay(request.text, now)
  const horizonDate = localDate(new Date(now.getTime() + 45 * 86_400_000))
  const selected = events.filter((event) => {
    if (categories.size && !categories.has(event.category)) return false
    if (!isRelevantDate(event, now, horizonDate)) return false
    if (day && ((dateKey(event.startsAt) ?? '') > day
      || (dateKey(event.endsAt ?? event.startsAt) ?? '') < day)) return false
    if (request.budgetKzt === 0 && event.priceKzt !== 0) return false
    if (request.budgetKzt !== undefined && event.priceKzt !== undefined
      && event.priceKzt > request.budgetKzt) return false
    if (request.accessibility === 'osm_wheelchair_yes'
      && (!event.placeId || !wheelchairTaggedIds.has(event.placeId))) return false
    return true
  })
  const today = localDate(now)
  const byDate = (a: LiveEvent, b: LiveEvent): number => {
    const aOngoing = (dateKey(a.startsAt) ?? '') <= today && (dateKey(a.endsAt ?? a.startsAt) ?? '') >= today
    const bOngoing = (dateKey(b.startsAt) ?? '') <= today && (dateKey(b.endsAt ?? b.startsAt) ?? '') >= today
    if (aOngoing !== bOngoing) return aOngoing ? -1 : 1
    return a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title)
  }
  selected.sort(byDate)
  if (categories.size === 1) return selected.slice(0, 5)
  // A broad "what is on" request should not be filled entirely by one busy
  // concert calendar when a sourced exhibition or home match is also listed.
  const varied: LiveEvent[] = []
  const seenCategories = new Set<EventCategory>()
  for (const event of selected) {
    if (seenCategories.has(event.category)) continue
    varied.push(event)
    seenCategories.add(event.category)
  }
  for (const event of selected) {
    if (varied.length >= 5) break
    if (!varied.includes(event)) varied.push(event)
  }
  return varied.sort(byDate).slice(0, 5)
}
