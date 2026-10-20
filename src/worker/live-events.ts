import type { Language, LiveEvent } from '../shared/types'

export type { LiveEvent } from '../shared/types'

export interface LiveEventsStatus {
  events: LiveEvent[]
  checkedSources: string[]
  failedSources: string[]
}

interface Options {
  now?: Date
  fetcher?: typeof fetch
  language?: Language
}

interface SourcePage { html: string; checkedAt: string }
interface CacheEntry { page: SourcePage | null; expiresAt: number }

const QAZAQCONCERT_URL = 'https://qazaqconcert.kz/ru/'
const ASTANA_TOURISM_URL = 'https://astanatourism.kz/ru/events-ru'
const BARYS_URL = 'https://ru.hcbarys.kz/tickets/tickets/'
const SOURCE_URLS = [QAZAQCONCERT_URL, ASTANA_TOURISM_URL, BARYS_URL] as const
const PAGE_CACHE = new Map<string, CacheEntry>()
const PAGE_TTL_MS = 30 * 60_000
const FAILURE_TTL_MS = 2 * 60_000
const TIMEOUT_MS = 3_500
const MAX_HTML_BYTES = 250_000
const HORIZON_DAYS = 45
const MAX_EVENTS_PER_SOURCE = 24
const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
}

function decodeHtml(value: string): string {
  const codepoint = (raw: string, radix: number): string => {
    const number = Number.parseInt(raw, radix)
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : ' '
  }
  return value.replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, (_, code: string) => codepoint(code, 10))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => codepoint(code, 16))
    .replace(/&(?:nbsp|#160);/gi, ' ').replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'").replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»')
    .replace(/&amp;/gi, '&').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function field(block: string, className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`<[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))
  return match ? decodeHtml(match[1]) : ''
}

function dateParts(day: number, month: number, year: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dottedDate(value: string): string | null {
  const match = value.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/)
  return match ? dateParts(Number(match[1]), Number(match[2]), Number(match[3])) : null
}

function tourismDate(value: string): { start: string; end?: string } | null {
  const match = value.toLowerCase().match(/\b(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(20\d{2})\b/u)
  if (!match) return null
  const month = MONTHS[match[3]]
  const year = Number(match[4])
  const start = dateParts(Number(match[1]), month, year)
  const end = match[2] ? dateParts(Number(match[2]), month, year) : undefined
  if (!start || (match[2] && (!end || end < start))) return null
  return { start, ...(end ? { end } : {}) }
}

function localDate(now: Date): string {
  // Kazakhstan has used UTC+05:00 nationwide since March 2024.
  return new Date(now.getTime() + 5 * 60 * 60_000).toISOString().slice(0, 10)
}

function inWindow(event: LiveEvent, now: Date): boolean {
  const today = localDate(now)
  const lastDay = localDate(new Date(now.getTime() + HORIZON_DAYS * 86_400_000))
  const eventDay = event.startsAt.slice(0, 10)
  if (eventDay > lastDay || (event.endsAt ?? eventDay) < today) return false
  if (event.startsAt.includes('T') && Date.parse(event.startsAt) < now.getTime()) return false
  return true
}

function safeEventUrl(raw: string, expectedHost: string, path: RegExp): string | null {
  try {
    const url = new URL(raw, `https://${expectedHost}`)
    if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username
      || url.password || !path.test(url.pathname)) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch { return null }
}

function shortTitle(value: string): string | null {
  const title = decodeHtml(value)
  return title.length >= 3 && title.length <= 160 ? title : null
}

function explicitlyCancelled(title: string, details = ''): boolean {
  return /\b(?:cancelled|canceled)\b|отмен[её]н|отменено|отменяется|болдырылма/u.test(`${title} ${details}`.toLowerCase())
}

function qazaqconcertEvents(page: SourcePage): LiveEvent[] {
  const events: LiveEvent[] = []
  const blocks = page.html.match(/<div\s+class=["']concert__card\b[\s\S]*?(?=<div\s+class=["']concert__card\b|$)/gi) ?? []
  for (const block of blocks.slice(0, 40)) {
    const match = block.match(/<a\s+href=["']([^"']+)["']\s+class=["']concert__caption["'][^>]*>([\s\S]*?)<\/a>/i)
    const sourceUrl = match && safeEventUrl(match[1], 'qazaqconcert.kz', /^\/ru\/poster\/[a-z0-9_\-]+\/?$/i)
    const title = match && shortTitle(match[2])
    const date = dottedDate(field(block, 'concert__date'))
    const time = field(block, 'concert__time').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)
    const hall = field(block, 'concert__hall').replace(/^Зал:\s*/iu, '')
    // Other halls in this calendar may be outside Astana; only its verified home venue is used.
    if (!sourceUrl || !title || !date || !time
      || explicitlyCancelled(title, `${field(block, 'concert__status')} ${field(block, 'concert__notice')}`)
      || !/^(?:Большой|Камерный) зал$/iu.test(hall)) continue
    const startsAt = `${date}T${time[1]}:${time[2]}:00+05:00`
    events.push({
      id: `qazaqconcert:${new URL(sourceUrl).pathname.split('/').pop()}:${date}`,
      title,
      category: /комеди|спектакл|театр|мюзикл/iu.test(title) ? 'evening' : 'concert',
      startsAt,
      venueName: `ЦКЗ «Qazaqstan», ${hall}`,
      sourceUrl,
      sourceName: 'Қазақконцерт',
      checkedAt: page.checkedAt,
    })
    if (events.length >= MAX_EVENTS_PER_SOURCE) break
  }
  return events
}

function tourismCategory(title: string, description: string): LiveEvent['category'] | null {
  const value = `${title} ${description}`.toLowerCase()
  if (/фестивал|festival|fest\b/u.test(value)) return 'festival'
  if (/спорт|кубок|чемпионат|турнир|плавани|футбол|хоккей|sport\b|world aquatics/u.test(value)) return 'sport'
  if (/выстав|экспо|expo\b|exhibition|көрме/u.test(value)) return 'exhibition'
  if (/концерт|concert|музык/u.test(value)) return 'concert'
  if (/вечерин|вечерн|night|party/u.test(value)) return 'evening'
  return null
}

function tourismVenue(value: string): string | null {
  if (/^МВЦ EXPO$/iu.test(value)) return 'МВЦ EXPO'
  if (/^бассейн\s+[«"]?Барыс Арена[»"]?$/iu.test(value)) return 'Барыс Арена, бассейн'
  return null
}

function tourismEvents(page: SourcePage): LiveEvent[] {
  const events: LiveEvent[] = []
  const blocks = page.html.match(/<div\s+class=["']events__item\s+item\d+["'][\s\S]*?(?=<div\s+class=["']events__item\s+item\d+["']|<div\s+class=["']events__loader|$)/gi) ?? []
  for (const block of blocks.slice(0, 50)) {
    const title = shortTitle(field(block, 'events__item-title'))
    const venueName = tourismVenue(field(block, 'events__item-location'))
    const date = tourismDate(field(block, 'events__item-date'))
    const category = title && tourismCategory(title, field(block, 'events__item-text'))
    if (!title || !venueName || !date || !category
      || explicitlyCancelled(title, field(block, 'events__item-text'))) continue
    events.push({
      id: `astana-tourism:${date.start}:${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 90)}`,
      title,
      category,
      startsAt: date.start,
      ...(date.end ? { endsAt: date.end } : {}),
      venueName,
      sourceUrl: ASTANA_TOURISM_URL,
      sourceName: 'Astana Tourism',
      checkedAt: page.checkedAt,
    })
    if (events.length >= MAX_EVENTS_PER_SOURCE) break
  }
  return events
}

function barysEvents(page: SourcePage): LiveEvent[] {
  const events: LiveEvent[] = []
  const blocks = page.html.match(/<article\s+class=["']champ-match\b[\s\S]*?(?=<article\s+class=["']champ-match\b|$)/gi) ?? []
  for (const block of blocks.slice(0, 50)) {
    const teams = [...block.matchAll(/<span\s+class=["']ma-team__name[^"']*["'][^>]*>\s*<span>([^<]+)<\/span>/gi)]
      .map((match) => decodeHtml(match[1]))
    const cities = [...block.matchAll(/<span\s+class=["']ma-team__city["'][^>]*>([^<]+)<\/span>/gi)]
      .map((match) => decodeHtml(match[1]))
    const time = block.match(/<time\s+class=["']ma-date["']\s+datetime=["'](20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:00)["']/i)?.[1]
    const link = block.match(/href=["'](\/championship\/matches\/\d+\/(?:\?[^"']*)?)["']/i)?.[1]
    const sourceUrl = link && safeEventUrl(link, 'ru.hcbarys.kz', /^\/championship\/matches\/\d+\/$/)
    if (teams.length < 2 || cities.length < 2 || teams[0] !== 'Барыс' || cities[0] !== 'Астана'
      || !time || !Number.isFinite(Date.parse(time)) || !sourceUrl
      || explicitlyCancelled(`${teams[0]} — ${teams[1]}`)) continue
    events.push({
      id: `barys:${new URL(sourceUrl).pathname.split('/').filter(Boolean).pop()}`,
      title: `${teams[0]} — ${teams[1]}`,
      category: 'sport',
      startsAt: time,
      venueName: 'Барыс Арена',
      sourceUrl,
      sourceName: 'ХК «Барыс»',
      checkedAt: page.checkedAt,
    })
    if (events.length >= MAX_EVENTS_PER_SOURCE) break
  }
  return events
}

async function fetchPage(url: typeof SOURCE_URLS[number], fetcher: typeof fetch, now: Date): Promise<SourcePage | null> {
  const useCache = fetcher === fetch
  const cached = useCache ? PAGE_CACHE.get(url) : undefined
  if (cached && cached.expiresAt > now.getTime()) return cached.page
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let page: SourcePage | null = null
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    })
    const expectedHost = new URL(url).hostname
    const responseHost = response.url ? new URL(response.url).hostname : expectedHost
    if (!response.ok || responseHost !== expectedHost ||
      Number(response.headers.get('content-length') ?? 0) > MAX_HTML_BYTES ||
      (response.headers.get('content-type') && !response.headers.get('content-type')?.includes('text/html'))) return null
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_HTML_BYTES) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    page = { html: new TextDecoder('utf-8').decode(bytes), checkedAt: now.toISOString() }
    return page
  } catch { return null }
  finally {
    clearTimeout(timeout)
    if (useCache) PAGE_CACHE.set(url, { page, expiresAt: now.getTime() + (page ? PAGE_TTL_MS : FAILURE_TTL_MS) })
  }
}

/** Retrieves only dated, source-linked events in Astana within the next 45 days. */
export async function fetchLiveEventsWithStatus(options: Options = {}): Promise<LiveEventsStatus> {
  const now = options.now ?? new Date()
  const fetcher = options.fetcher ?? fetch
  const [concertPage, tourismPage, barysPage] = await Promise.all(SOURCE_URLS.map((url) => fetchPage(url, fetcher, now)))
  const checkedSources: string[] = []
  const failedSources: string[] = []
  if (concertPage) checkedSources.push('Қазақконцерт'); else failedSources.push('Қазақконцерт')
  if (tourismPage) checkedSources.push('Astana Tourism'); else failedSources.push('Astana Tourism')
  if (barysPage) checkedSources.push('ХК «Барыс»'); else failedSources.push('ХК «Барыс»')
  const events = [
    ...(concertPage ? qazaqconcertEvents(concertPage) : []),
    ...(tourismPage ? tourismEvents(tourismPage) : []),
    ...(barysPage ? barysEvents(barysPage) : []),
  ].filter((event) => inWindow(event, now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
  return { events, checkedSources, failedSources }
}

export async function fetchLiveEvents(options: Options = {}): Promise<LiveEvent[]> {
  return (await fetchLiveEventsWithStatus(options)).events
}
