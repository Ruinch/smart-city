import type { Language, Recommendation } from '../shared/types'
import type { DynamicPlace } from './dynamic'
import type { PriceEvidence } from './price-research'

export type VenueDetailKind = 'hours' | 'menu' | 'feature' | 'accessibility' | 'booking'
type DetailTopic = 'accessibility' | 'hours' | 'menu' | 'booking' | 'diet' | 'cuisine'
  | 'outdoor' | 'wifi' | 'outlets' | 'reading' | 'quiet' | 'music' | 'breakfast' | 'pastries' | 'tasting'

export interface VenueDetail {
  id: string
  kind: VenueDetailKind
  claim: string
  sourceUrl: string
  /** Retrieval time for a live page; it is not the source's publication date. */
  checkedAt?: string
  sourceKind: 'osm' | 'official_site' | 'visit_astana'
  /** Internal selection cue; omitted from public recommendation evidence. */
  topic?: DetailTopic
}

export interface VenueDetailPrice extends PriceEvidence {
  /** Used to prefer an official branch price when several sources are available. */
  sourceKind: 'official_site' | 'visit_astana'
}

export interface VenueDetailsResult {
  details: VenueDetail[]
  prices: VenueDetailPrice[]
}

type Fetcher = typeof fetch
type Page = { html: string | null; checkedAt: string; expires: number }
type SiteCandidate = { venue: DynamicPlace; url: string; sourceKind: 'official_site' | 'visit_astana' }

const VISIT_ASTANA_INDEX = 'https://visitastana.kz/en/sitemap-iblock-42.xml'
const GASTRONOMY = new Set(['cafe', 'restaurant', 'fast_food', 'food_court', 'ice_cream',
  'confectionery', 'bar', 'biergarten', 'coffee'])
const PAGE_CACHE = new Map<string, Page>()
const MAX_CACHE_ENTRIES = 80
const MAX_PAGE_FETCHES = 3
const MAX_INDEX_BYTES = 40_000
const MAX_PAGE_BYTES = 180_000
const PAGE_TTL_MS = 6 * 60 * 60_000
const FAILURE_TTL_MS = 15 * 60_000
const TIMEOUT_MS = 3_500

const CHAR_MAP: Record<string, string> = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'i', к: 'k', қ: 'k', л: 'l', м: 'm', н: 'n', ң: 'ng', о: 'o',
  ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h',
  һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'y', і: 'i', э: 'e', ю: 'yu', я: 'ya',
  ь: '', ъ: '',
}

function latin(value: string): string {
  return [...value.normalize('NFKC').toLocaleLowerCase('ru')]
    .map((char) => CHAR_MAP[char] ?? char).join('')
    .replace(/ngg/g, 'ng').replace(/[^a-z0-9/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function nameKey(value: string): string {
  return latin(value).replace(/\b(?:restaurant|restoran|cafe|kafe|coffee shop|bar)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function venueNames(venue: DynamicPlace): string[] {
  return [venue.name, venue.names?.ru, venue.names?.kk, venue.names?.en,
    venue.tags['name:ru'], venue.tags['name:kk'], venue.tags['name:en']]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
}

function namesMatch(venue: DynamicPlace, pageName: string): boolean {
  const pageKey = nameKey(pageName)
  return pageKey.length >= 4 && venueNames(venue).some((name) => nameKey(name) === pageKey)
}

function localized(language: Language, ru: string, kk: string, en: string): string {
  return language === 'kk' ? kk : language === 'en' ? en : ru
}

function safePublicUrl(raw: string | undefined): string | null {
  if (!raw || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.')
      || host.includes(':') || /^[\d.]+$/.test(host)
      || /(^|\.)(?:localhost|local|internal|test|invalid|example|onion|lan|home|arpa)$/.test(host)) return null
    url.hash = ''
    return url.toString()
  } catch { return null }
}

function officialWebsite(venue: DynamicPlace): string | null {
  if (venue.provider !== 'OpenStreetMap') return null
  for (const raw of [venue.tags.website, venue.tags['contact:website'], venue.tags.url]) {
    const url = safePublicUrl(raw)
    if (!url) continue
    const host = new URL(url).hostname
    if (/(^|\.)(?:instagram|facebook|tiktok|x|twitter|youtube|2gis|google|yandex|linktr)\./i.test(host)) continue
    return url
  }
  return null
}

function osmRecordUrl(venue: DynamicPlace): string | null {
  if (venue.provider !== 'OpenStreetMap') return null
  const url = safePublicUrl(venue.sourceUrl)
  if (!url) return null
  const parsed = new URL(url)
  return ['openstreetmap.org', 'www.openstreetmap.org'].includes(parsed.hostname)
    && /^\/(?:node|way|relation)\/\d+$/.test(parsed.pathname) ? url : null
}

function remember(url: string, page: Page): void {
  if (PAGE_CACHE.size >= MAX_CACHE_ENTRIES) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value!)
  PAGE_CACHE.set(url, page)
}

async function fetchPage(url: string, maxBytes: number, fetcher: Fetcher, useCache: boolean,
  checkedAt: string, mime: 'html' | 'xml' = 'html'): Promise<Page | null> {
  const safe = safePublicUrl(url)
  if (!safe) return null
  const cached = useCache ? PAGE_CACHE.get(safe) : undefined
  if (cached && cached.expires > Date.now()) return cached.html ? cached : null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let html: string | null = null
  try {
    const response = await fetcher(safe, { signal: controller.signal, redirect: 'manual',
      headers: { Accept: mime === 'xml' ? 'application/xml, text/xml' : 'text/html' } })
    const finalUrl = response.url ? safePublicUrl(response.url) : safe
    const length = Number(response.headers.get('content-length') ?? 0)
    const acceptedType = mime === 'xml' ? /(?:application|text)\/xml/i : /text\/html/i
    if (response.status !== 200 || finalUrl !== safe || !acceptedType.test(response.headers.get('content-type') ?? '')
      || (length > 0 && length > maxBytes) || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    html = new TextDecoder().decode(bytes)
    return { html, checkedAt, expires: Date.now() + PAGE_TTL_MS }
  } catch { return null }
  finally {
    clearTimeout(timer)
    if (useCache) remember(safe, { html, checkedAt,
      expires: Date.now() + (html ? PAGE_TTL_MS : FAILURE_TTL_MS) })
  }
}

function textOf(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#8239;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–').replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const number = Number(code)
      return number >= 32 && number <= 0x10ffff ? String.fromCodePoint(number) : ' '
    })
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

interface VisitPage { key: string; digitSeparatedKey: string; suffixlessKey: string; url: string }

function visitAstanaPages(sitemap: string): VisitPage[] {
  const pages: VisitPage[] = []
  for (const match of sitemap.matchAll(/<loc>\s*(https:\/\/[^<\s]+)\s*<\/loc>/gi)) {
    const url = safePublicUrl(match[1].replace(/&amp;/g, '&'))
    if (!url) continue
    const parsed = new URL(url)
    if (!['visitastana.kz', 'www.visitastana.kz'].includes(parsed.hostname)
      || !/^\/en\/about-city\/where-to-eat\/[a-z0-9-]+\/?$/.test(parsed.pathname)) continue
    const slug = parsed.pathname.split('/').filter(Boolean).at(-1)!
    const key = nameKey(slug.replace(/-/g, ' '))
    const digitSeparatedKey = nameKey(slug.replace(/([a-z])(\d+)$/i, '$1 $2').replace(/-/g, ' '))
    const suffixlessKey = nameKey(slug.replace(/\d+$/, '').replace(/-/g, ' '))
    // Bitrix serves the gastronomy index, rather than the detail, for some
    // slashless sitemap URLs while still returning HTTP 200.
    if (key.length >= 4) pages.push({ key, digitSeparatedKey, suffixlessKey,
      url: `${url.replace(/\/$/, '')}/` })
  }
  return pages
}

function matchedVisitPage(venue: DynamicPlace, pages: VisitPage[]): string | undefined {
  const names = venueNames(venue).map(nameKey).filter((name) => name.length >= 4)
  return pages.find((page) => names.some((name) => [page.key, page.digitSeparatedKey].some((key) =>
    key === name || key.endsWith(` ${name}`))
    || (name.includes(' ') && (page.suffixlessKey === name
      || page.suffixlessKey.endsWith(` ${name}`)))))?.url
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180
  const latitude = (a.lat + b.lat) / 2 * radians
  return Math.hypot((a.lat - b.lat) * 111_195, (a.lon - b.lon) * 111_195 * Math.cos(latitude))
}

const STREET_WORDS = new Set(['street', 'st', 'avenue', 'ave', 'road', 'rd', 'prospekt', 'pr',
  'ulitsa', 'ul', 'koshesi', 'kosh', 'dangyly', 'danggyly', 'd', 'boulevard', 'blvd', 'bulvar', 'shosse'])

function streetKey(value: string): string {
  return latin(value).split(' ').filter((part) => part.length >= 2 && !STREET_WORDS.has(part)).join(' ')
}

function houseMatches(line: string, house: string): boolean {
  const escaped = latin(house).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return !!escaped && new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(latin(line))
}

function addressLineMatches(venue: DynamicPlace, line: string): boolean {
  const street = streetKey(venue.tags['addr:street'] ?? '')
  const house = venue.tags['addr:housenumber'] ?? ''
  return street.length >= 3 && house.length > 0 && latin(line).includes(street) && houseMatches(line, house)
}

function pageTitle(html: string): string {
  return textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/^Visit Astana\s*[-–—]\s*/i, '').trim()
}

function addressLines(contactHtml: string): string[] {
  const match = contactHtml.match(/<h3[^>]*>\s*Address\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/i)
  return match ? match[1].split(/<br\s*\/?\s*>/i).map(textOf).filter(Boolean) : []
}

function mapCenter(contactHtml: string): { lat: number; lon: number } | null {
  const match = contactHtml.match(/\bcenter:\s*\[\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\]/i)
  if (!match) return null
  const lat = Number(match[1]), lon = Number(match[2])
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
}

function visitBranchMatches(venue: DynamicPlace, contactHtml: string): { matched: boolean; singleBranch: boolean } {
  const lines = addressLines(contactHtml)
  const center = mapCenter(contactHtml)
  const nearby = !!center && distanceMeters(venue, center) <= 180
  const hasAddress = !!venue.tags['addr:street'] && !!venue.tags['addr:housenumber']
  const matched = nearby && (!hasAddress || lines.some((line) => addressLineMatches(venue, line)))
  return { matched, singleBranch: lines.length === 1 && (!center || nearby) }
}

const FEATURES: Array<{ pattern: RegExp; topic: DetailTopic; ru: string; kk: string; en: string }> = [
  { pattern: /\btasting (?:set|menu)\b/i, topic: 'tasting', ru: 'В описании есть дегустационное меню.',
    kk: 'Сипаттамада дәм тату мәзірі көрсетілген.', en: 'The description mentions a tasting menu.' },
  { pattern: /\b(?:signature )?breakfasts?\b/i, topic: 'breakfast', ru: 'В меню упоминаются завтраки.',
    kk: 'Мәзірде таңғы ас аталады.', en: 'Breakfast is mentioned on the menu.' },
  { pattern: /\b(?:fresh )?pastries\b|\bbakery\b/i, topic: 'pastries', ru: 'В описании упоминается выпечка.',
    kk: 'Сипаттамада жаңа піскен тоқаштар аталады.', en: 'The description mentions pastries.' },
  { pattern: /\bvegetarian (?:dishes|options|menu)\b/i, topic: 'diet', ru: 'В описании есть вегетарианские позиции.',
    kk: 'Сипаттамада вегетариандық тағамдар аталады.', en: 'Vegetarian options are mentioned.' },
  { pattern: /\blive music\b/i, topic: 'music', ru: 'В описании упоминается живая музыка; программу уточните.',
    kk: 'Сипаттамада жанды музыка аталады; бағдарламаны нақтылаңыз.', en: 'Live music is mentioned; check the current programme.' },
  { pattern: /\b(?:open-air )?terrace\b/i, topic: 'outdoor', ru: 'В описании упоминается терраса; доступность уточните.',
    kk: 'Сипаттамада терраса аталады; қолжетімділігін нақтылаңыз.', en: 'A terrace is mentioned; check its availability.' },
  { pattern: /\b(?:kazakh|national) cuisine\b|\bbeshbarmak\b/i, topic: 'cuisine', ru: 'В описании есть блюда казахской кухни.',
    kk: 'Сипаттамада қазақ тағамдары аталады.', en: 'Kazakh dishes are mentioned in the description.' },
]

function visitDetails(candidate: SiteCandidate, html: string, language: Language, checkedAt: string): VenueDetailsResult {
  const empty: VenueDetailsResult = { details: [], prices: [] }
  const { venue, url } = candidate
  if (!namesMatch(venue, pageTitle(html))) return empty
  const aboutStart = html.indexOf('gastronomy-single__about')
  const contactsStart = html.indexOf('gastronomy-single__contacts')
  if (aboutStart < 0 || contactsStart <= aboutStart || contactsStart - aboutStart > 50_000) return empty
  const mainEnd = html.indexOf('</main>', contactsStart)
  const contactHtml = html.slice(contactsStart, Math.min(mainEnd < 0 ? html.length : mainEnd, contactsStart + 15_000))
  const branch = visitBranchMatches(venue, contactHtml)
  if (!branch.matched) return empty
  const aboutHtml = html.slice(aboutStart, contactsStart)
  const about = textOf(aboutHtml)
  const key = nameKey(venue.name)
  const normalizedAbout = ` ${latin(about)} `
  const center = mapCenter(contactHtml)
  if (!key || !normalizedAbout.includes(` ${key} `)
    || /\b(?:casino|gambling|sports betting|slot machines|kazino|bukmeker)\b/i.test(normalizedAbout)
    || !center || distanceMeters(center, { lat: 51.128, lon: 71.43 }) > 30_000) return empty
  const add = (kind: VenueDetailKind, claim: string, topic: DetailTopic) => empty.details.push({
    id: venue.id, kind, claim, sourceUrl: url, checkedAt, sourceKind: 'visit_astana', topic,
  })

  const schedule = textOf(html.match(/class="[^"]*banner--gastronomy-single-schedule[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '')
  const daily = schedule.match(/\bfrom\s+(\d{1,2}:\d{2})\s+to\s+(\d{1,2}:\d{2})\s+daily\b/i)
  if (daily) add('hours', localized(language,
    `Visit Astana указывает часы: ежедневно ${daily[1]}–${daily[2]}; проверьте перед визитом.`,
    `Visit Astana дерегі: күн сайын ${daily[1]}–${daily[2]}; барар алдында тексеріңіз.`,
    `Visit Astana lists daily hours ${daily[1]}–${daily[2]}; check before visiting.`), 'hours')
  else if (/\b\d{1,2}:\d{2}\b/.test(schedule)) add('hours', localized(language,
    'Visit Astana публикует режим работы; проверьте перед визитом.',
    'Visit Astana жұмыс уақытын жариялайды; барар алдында тексеріңіз.',
    'Visit Astana publishes opening hours; check before visiting.'), 'hours')

  if (/\b(?:Food Menu|Меню блюд|Food menu)\b/i.test(about)) add('menu', localized(language,
    'На Visit Astana есть ссылка на меню; цены уточните.',
    'Visit Astana бетінде мәзірге сілтеме бар; бағаларды нақтылаңыз.',
    'Visit Astana links to a menu; confirm current prices.'), 'menu')
  for (const feature of FEATURES) {
    if (feature.pattern.test(about)) add('feature', localized(language, feature.ru, feature.kk, feature.en), feature.topic)
    if (empty.details.filter((detail) => detail.kind === 'feature').length >= 2) break
  }

  if (branch.singleBranch) {
    const match = about.match(/\bAverage check\s*:\s*([\d\s\u00a0\u202f]{3,9})\s*(?:KZT|tenge|₸)\b/i)
    const minKzt = match ? Number(match[1].replace(/\D/g, '')) : NaN
    if (Number.isSafeInteger(minKzt) && minKzt >= 100 && minKzt <= 1_000_000) {
      empty.prices.push({ id: venue.id, minKzt, unit: 'average_bill', qualifier: 'exact',
        checkedAt, sourceUrl: url, sourceKind: 'visit_astana' })
    }
  }
  return empty
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function jsonLdEntities(html: string): Record<string, unknown>[] {
  const entities: Record<string, unknown>[] = []
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const script of scripts) {
    if (script[1].length > 40_000) continue
    try {
      const queue: unknown[] = [JSON.parse(script[1])]
      while (queue.length && entities.length < 30) {
        const value = queue.shift()
        if (Array.isArray(value)) { queue.push(...value.slice(0, 30)); continue }
        const item = record(value)
        if (!item) continue
        entities.push(item)
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph'].slice(0, 30))
      }
    } catch { /* Malformed structured data is not evidence. */ }
  }
  return entities
}

function schemaBranchMatches(venue: DynamicPlace, entity: Record<string, unknown>): boolean {
  if (typeof entity.name !== 'string' || !namesMatch(venue, entity.name)) return false
  const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']]
  if (!types.some((type) => typeof type === 'string'
    && /^(?:LocalBusiness|Restaurant|CafeOrCoffeeShop|FoodEstablishment|Museum|PerformingArtsTheater|TouristAttraction|ShoppingCenter|Store)$/i.test(type))) return false
  const address = record(entity.address)
  const streetAddress = typeof entity.address === 'string' ? entity.address
    : typeof address?.streetAddress === 'string' ? address.streetAddress : ''
  const locality = typeof address?.addressLocality === 'string' ? latin(address.addressLocality) : ''
  const geo = record(entity.geo)
  const lat = Number(geo?.latitude), lon = Number(geo?.longitude)
  const astanaGeo = Number.isFinite(lat) && Number.isFinite(lon)
    && distanceMeters({ lat, lon }, { lat: 51.128, lon: 71.43 }) <= 30_000
  if (!astanaGeo && !/(?:^| )(?:astana|nur sultan)(?: |$)/.test(locality)) return false
  if (venue.tags['addr:street'] && venue.tags['addr:housenumber']) return addressLineMatches(venue, streetAddress)
  return Number.isFinite(lat) && Number.isFinite(lon) && distanceMeters(venue, { lat, lon }) <= 180
}

function officialDetails(candidate: SiteCandidate, html: string, language: Language, checkedAt: string): VenueDetailsResult {
  const empty: VenueDetailsResult = { details: [], prices: [] }
  const entity = jsonLdEntities(html).find((item) => schemaBranchMatches(candidate.venue, item))
  if (!entity) return empty
  const { venue, url } = candidate
  const add = (kind: VenueDetailKind, claim: string, topic: DetailTopic) => empty.details.push({
    id: venue.id, kind, claim, sourceUrl: url, checkedAt, sourceKind: 'official_site', topic,
  })
  if (entity.openingHours || entity.openingHoursSpecification) add('hours', localized(language,
    'На сайте заведения указаны часы работы; проверьте перед визитом.',
    'Мекеме сайтында жұмыс уақыты көрсетілген; барар алдында тексеріңіз.',
    'The venue website lists opening hours; check before visiting.'), 'hours')
  if (entity.menu || entity.hasMenu) add('menu', localized(language,
    'На сайте заведения есть меню; цены уточните.',
    'Мекеме сайтында мәзір бар; бағаларды нақтылаңыз.',
    'The venue website has a menu; confirm current prices.'), 'menu')
  if (entity.acceptsReservations === true || entity.acceptsReservations === 'True') add('booking', localized(language,
    'Сайт заведения сообщает о бронировании; наличие мест уточните.',
    'Мекеме сайтында брондау көрсетілген; бос орынды нақтылаңыз.',
    'The venue website lists reservations; confirm availability.'), 'booking')
  const average = typeof entity.averageCheck === 'string'
    ? entity.averageCheck.match(/([\d\s\u00a0\u202f]{3,9})\s*(?:KZT|тенге|₸)/i) : null
  const minKzt = average ? Number(average[1].replace(/\D/g, '')) : NaN
  if (Number.isSafeInteger(minKzt) && minKzt >= 100 && minKzt <= 1_000_000) {
    empty.prices.push({ id: venue.id, minKzt, unit: 'average_bill', qualifier: 'exact',
      checkedAt, sourceUrl: url, sourceKind: 'official_site' })
  }
  return empty
}

const CUISINE: Record<string, [string, string, string]> = {
  kazakh: ['казахская кухня', 'қазақ асханасы', 'Kazakh cuisine'],
  italian: ['итальянская кухня', 'итальян асханасы', 'Italian cuisine'],
  georgian: ['грузинская кухня', 'грузин асханасы', 'Georgian cuisine'],
  japanese: ['японская кухня', 'жапон асханасы', 'Japanese cuisine'],
  korean: ['корейская кухня', 'корей асханасы', 'Korean cuisine'],
  chinese: ['китайская кухня', 'қытай асханасы', 'Chinese cuisine'],
  indian: ['индийская кухня', 'үнді асханасы', 'Indian cuisine'],
  vegetarian: ['вегетарианская кухня', 'вегетариандық асхана', 'vegetarian food'],
  pizza: ['пицца', 'пицца', 'pizza'],
  sushi: ['суши', 'суши', 'sushi'],
  coffee_shop: ['кофе', 'кофе', 'coffee'],
}

function osmDetails(venue: DynamicPlace, language: Language): VenueDetail[] {
  const sourceUrl = osmRecordUrl(venue)
  if (!sourceUrl) return []
  const details: VenueDetail[] = []
  const add = (kind: VenueDetailKind, ru: string, kk: string, en: string, topic: DetailTopic) => details.push({
    id: venue.id, kind, claim: localized(language, ru, kk, en), sourceUrl, sourceKind: 'osm', topic,
  })
  if (venue.tags['toilets:wheelchair'] === 'yes') add('accessibility',
    'В OSM отмечен туалет для коляски; проверьте на месте.',
    'OSM-де арбаға қолайлы дәретхана көрсетілген; барған жерде тексеріңіз.',
    'OSM marks a wheelchair-accessible toilet; verify on site.', 'accessibility')
  const hours = venue.tags.opening_hours?.trim()
  if (hours && hours.length <= 100 && !/[\u0000-\u001f<>]/.test(hours)) add('hours',
    `В OSM указан режим «${hours}»; проверьте перед визитом.`,
    `OSM-де жұмыс уақыты «${hours}» деп көрсетілген; барар алдында тексеріңіз.`,
    `OSM lists hours as “${hours}”; check before visiting.`, 'hours')
  const vegan = ['yes', 'only'].includes(venue.tags['diet:vegan'])
  const vegetarian = ['yes', 'only'].includes(venue.tags['diet:vegetarian'])
  if (vegan && vegetarian) add('feature',
    'В OSM отмечены веганские и вегетарианские блюда; уточните меню.',
    'OSM-де вегандық және вегетариандық тағамдар көрсетілген; мәзірді нақтылаңыз.',
    'OSM marks vegan and vegetarian options; check the menu.', 'diet')
  else if (vegan) add('feature',
    'В OSM отмечены веганские блюда; уточните меню.',
    'OSM-де вегандық тағамдар көрсетілген; мәзірді нақтылаңыз.',
    'OSM marks vegan options; check the menu.', 'diet')
  else if (vegetarian) add('feature',
    'В OSM отмечены вегетарианские блюда; уточните меню.',
    'OSM-де вегетариандық тағамдар көрсетілген; мәзірді нақтылаңыз.',
    'OSM marks vegetarian options; check the menu.', 'diet')
  const menuUrl = safePublicUrl(venue.tags['website:menu'])
  const website = officialWebsite(venue)
  if (menuUrl && website && new URL(menuUrl).hostname.replace(/^www\./, '')
    === new URL(website).hostname.replace(/^www\./, '')) {
    details.push({ id: venue.id, kind: 'menu',
      claim: localized(language,
        'В записи OSM приведена ссылка на меню; её актуальность проверьте.',
        'OSM жазбасында мәзірге сілтеме бар; оның өзектілігін тексеріңіз.',
        'The OSM record links to a menu; check that the link is current.'),
      sourceUrl, sourceKind: 'osm', topic: 'menu' })
  }
  const cuisines = (venue.tags.cuisine ?? '').split(/[;,]/).map((value) => value.trim().toLowerCase())
    .filter((value) => value in CUISINE).slice(0, 2)
  if (cuisines.length) {
    const names = cuisines.map((value) => CUISINE[value])
    add('feature', `В OSM указано: ${names.map((name) => name[0]).join(', ')}; уточните меню.`,
      `OSM дерегі: ${names.map((name) => name[1]).join(', ')}; мәзірді нақтылаңыз.`,
      `OSM lists ${names.map((name) => name[2]).join(', ')}; check the menu.`, 'cuisine')
  }
  if (venue.tags.outdoor_seating === 'yes') add('feature',
    'В OSM отмечены места на улице; наличие уточните.',
    'OSM-де сыртта отыратын орындар көрсетілген; бар-жоғын нақтылаңыз.',
    'OSM marks outdoor seating; check availability.', 'outdoor')
  if (venue.tags.internet_access === 'wlan') add('feature',
    'В OSM отмечен Wi-Fi; доступ уточните.',
    'OSM-де Wi-Fi көрсетілген; қолжетімділігін нақтылаңыз.',
    'OSM marks Wi-Fi; check access.', 'wifi')
  else if (venue.tags.internet_access === 'yes') add('feature',
    'В OSM отмечен доступ в интернет; условия уточните.',
    'OSM-де интернетке қолжетімділік көрсетілген; шарттарын нақтылаңыз.',
    'OSM marks internet access; check the terms.', 'wifi')
  if (venue.tags.reservation === 'required') add('booking',
    'В OSM указана обязательная бронь; уточните у заведения.',
    'OSM-де алдын ала брондау міндетті деп көрсетілген; мекемеден нақтылаңыз.',
    'OSM marks reservations as required; confirm with the venue.', 'booking')
  else if (venue.tags.reservation === 'yes') add('booking',
    'В OSM указана возможность бронирования; уточните у заведения.',
    'OSM-де брондау мүмкіндігі көрсетілген; мекемеден нақтылаңыз.',
    'OSM marks reservations as available; confirm with the venue.', 'booking')
  return details
}

/** Gather only explicit, branch-matched public details for already selected Astana stops. */
export async function collectVenueDetails(venues: DynamicPlace[], language: Language,
  options: { fetcher?: Fetcher; now?: Date } = {}): Promise<VenueDetailsResult> {
  const fetcher = options.fetcher ?? fetch
  const useCache = options.fetcher === undefined
  const checkedAt = (options.now ?? new Date()).toISOString()
  const distinct = [...new Map(venues.map((venue) => [venue.id, venue])).values()]
  const details = distinct.flatMap((venue) => osmDetails(venue, language))
  const prices: VenueDetailPrice[] = []
  const gastro = distinct.filter((venue) => GASTRONOMY.has(venue.category))
  let visitPages: VisitPage[] = []
  if (gastro.length) {
    const index = await fetchPage(VISIT_ASTANA_INDEX, MAX_INDEX_BYTES, fetcher, useCache, checkedAt, 'xml')
    if (index?.html) visitPages = visitAstanaPages(index.html)
  }
  const candidates: SiteCandidate[] = []
  for (const venue of distinct) {
    const visitUrl = matchedVisitPage(venue, visitPages)
    if (visitUrl && GASTRONOMY.has(venue.category)) candidates.push({ venue, url: visitUrl, sourceKind: 'visit_astana' })
    else {
      const url = officialWebsite(venue)
      if (url) candidates.push({ venue, url, sourceKind: 'official_site' })
    }
  }
  candidates.sort((a, b) => (a.sourceKind === 'visit_astana' ? 0 : 1)
    - (b.sourceKind === 'visit_astana' ? 0 : 1))
  const results = await Promise.all(candidates.slice(0, MAX_PAGE_FETCHES).map(async (candidate) => {
    const page = await fetchPage(candidate.url, MAX_PAGE_BYTES, fetcher, useCache, checkedAt)
    if (!page?.html) return null
    return candidate.sourceKind === 'visit_astana'
      ? visitDetails(candidate, page.html, language, page.checkedAt)
      : officialDetails(candidate, page.html, language, page.checkedAt)
  }))
  for (const result of results) {
    if (!result) continue
    details.push(...result.details)
    prices.push(...result.prices)
  }
  return { details, prices }
}

function requestedTopics(text: string): Set<DetailTopic> {
  const topics = new Set<DetailTopic>()
  const input = text.normalize('NFKC').toLocaleLowerCase('ru')
  const has = (pattern: RegExp, topic: DetailTopic) => { if (pattern.test(input)) topics.add(topic) }
  has(/коляск|доступн|wheelchair|accessible|арба|қолжетім/i, 'accessibility')
  has(/час|режим работы|открыт|сейчас|opening|open now|hours|жұмыс уақыт|қазір|ашық/i, 'hours')
  has(/меню|menu|блюд|dish|тағам/i, 'menu')
  has(/брон|резерв|столик|reservation|reserve|booking|бронда/i, 'booking')
  has(/веган|вегетариан|vegan|vegetarian/i, 'diet')
  has(/кухн|cuisine|асхана|бешбармак|beshbarmak|суши|ролл|sushi|rolls?|пицц|pizza|итальян|italian|япон|japanese|корей|korean|грузин|georgian|казах|қазақ|kazakh/i, 'cuisine')
  has(/террас|на улице|открытом воздух|outdoor|terrace|patio|далада/i, 'outdoor')
  has(/wi.?fi|вай.?фай|интернет|internet/i, 'wifi')
  has(/розет|зарядк|socket|outlet|power plug/i, 'outlets')
  has(/книг|чита|читать|book|reading|кітап|оқу/i, 'reading')
  has(/тих|спокойн|quiet|calm|тыныш/i, 'quiet')
  has(/музык|концерт|танц|вечерин|music|concert|dance|event|programme|бағдарлама/i, 'music')
  has(/завтрак|breakfast|таңғы ас/i, 'breakfast')
  has(/выпечк|булоч|круассан|pastr|bakery|тоқаш/i, 'pastries')
  has(/дегустац|tasting/i, 'tasting')
  return topics
}

function oldEvidenceTopic(entry: { kind?: VenueDetailKind; claim: string }): DetailTopic | undefined {
  if (entry.kind === 'hours') return 'hours'
  const claim = entry.claim.toLocaleLowerCase('ru')
  if (/розет|outlet|socket|қуат/i.test(claim)) return 'outlets'
  if (/книг|чтен|read|book|кітап|оқу/i.test(claim)) return 'reading'
  if (/спокойн|тих|calm|quiet|тыныш/i.test(claim)) return 'quiet'
  if (/вечерн|музык|event|programme|music|бағдарлама/i.test(claim)) return 'music'
  return undefined
}

/** Merge sourced details with earlier web evidence; choose four links for the current request. */
export function attachVenueDetails(stops: Recommendation[], details: VenueDetail[], requestText = ''): void {
  const byId = new Map<string, VenueDetail[]>()
  for (const detail of details) {
    const list = byId.get(detail.id) ?? []
    list.push(detail)
    byId.set(detail.id, list)
  }
  const wanted = requestedTopics(requestText)
  for (const stop of stops) {
    const own = byId.get(stop.id)
    if (!own?.length) continue
    type Choice = { claim: string; sourceUrl: string; checkedAt?: string; kind: VenueDetailKind;
      topic?: DetailTopic; source: 'direct' | 'osm' | 'web'; order: number }
    const earlier: Choice[] = (stop.evidence ?? []).map((entry, order) => ({
      ...entry, kind: entry.kind ?? 'feature', topic: oldEvidenceTopic(entry), source: 'web', order,
    }))
    const candidates: Choice[] = own.map((entry, order) => ({ ...entry,
      source: entry.sourceKind === 'osm' ? 'osm' : 'direct', order: order + earlier.length }))
    const score = (entry: Choice): number => {
      const relevant = !!entry.topic && wanted.has(entry.topic)
      const source = entry.source === 'direct' ? 30 : entry.source === 'osm' ? 20 : 10
      if (entry.kind === 'accessibility') return (relevant ? 1000 : 700) + source
      if (entry.kind === 'hours') return (relevant ? 900 : 280) + source
      return (relevant ? 650 : 100) + source
    }
    const seen = new Set<string>()
    const unique = (entry: Choice): boolean => {
      const key = `${entry.sourceUrl}|${entry.kind}|${entry.claim}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }
    const sorted = [...candidates, ...earlier].filter(unique)
      .sort((a, b) => score(b) - score(a) || a.order - b.order)
    const retainedWeb = sorted.find((entry) => entry.source === 'web')
    const picked = retainedWeb ? [retainedWeb] : []
    for (const entry of sorted) {
      if (picked.includes(entry)) continue
      picked.push(entry)
      if (picked.length === 4) break
    }
    picked.sort((a, b) => score(b) - score(a) || a.order - b.order)
    stop.evidence = picked.slice(0, 4).map(({ claim, sourceUrl, checkedAt, kind }) => ({ claim, sourceUrl,
      ...(checkedAt ? { checkedAt } : {}), kind }))
  }
}
