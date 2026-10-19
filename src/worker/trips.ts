import type { CityCatalog, Recommendation, Trip, WalkRequest } from '../shared/types'
import { routeUrl } from './recommend'
import { languageOf, pick } from './i18n'

const TRIP_KEYWORDS: Record<string, string[]> = {
  viewpoint: ['смотров', 'панорам', 'вид', 'природ'],
  nature: ['природ', 'лес', 'озер', 'горы'],
  museum: ['музей', 'истор', 'экспозиц'],
  history: ['истор', 'памят'],
}

export interface TripCandidate {
  trip: Trip
  travelMinutesApprox?: number
  totalMinutesApprox?: number
  budgetStatus: 'within' | 'possible' | 'unknown'
  score: number
}

function sourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function positiveEstimate(value: number | undefined, source: string | undefined): number | undefined {
  return sourceUrl(source) && typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value : undefined
}

function sourcedCost(trip: Trip): Trip['travel']['costKzt'] | undefined {
  const cost = trip.travel.costKzt
  return cost && sourceUrl(cost.sourceUrl) && Number.isFinite(cost.min) && Number.isFinite(cost.max)
    && cost.min >= 0 && cost.max >= cost.min ? cost : undefined
}

function budgetStatus(trip: Trip, budgetKzt: number | undefined): TripCandidate['budgetStatus'] {
  const estimate = sourcedCost(trip)
  if (budgetKzt === undefined || !estimate) return 'unknown'
  return estimate.max <= budgetKzt ? 'within' : 'possible'
}

export function rankTrips(trips: Trip[], city: CityCatalog, request: WalkRequest): TripCandidate[] {
  const transport = request.transport ?? 'car'
  if (transport === 'walk') return []

  const normalizedText = request.text.normalize('NFKC').toLocaleLowerCase('ru')
  const ranked: TripCandidate[] = []
  for (const trip of trips) {
    if (trip.cityId !== city.id) continue
    // Unknown road times must never make a distant trip look like a short walk.
    // These are conservative planning gates, not claims about actual driving.
    const planningMinimum = trip.durationClass === 'half_day' && sourceUrl(trip.durationSourceUrl) ? 240 : 480
    if (request.minutes < planningMinimum) continue
    if (request.intents.includes('indoors') && trip.setting !== 'indoor') continue
    if (request.intents.includes('outdoors') && trip.setting !== 'outdoor') continue
    // A known entrance fee cannot fit a zero budget, even when total trip cost is unknown.
    if (request.budgetKzt === 0 && trip.tags.fee?.trim().toLowerCase() === 'yes') continue
    const travelMinutesApprox = positiveEstimate(
      transport === 'car' ? trip.travel.driveMinutesApprox : trip.travel.transitMinutesApprox,
      trip.travel.sourceUrl,
    )
    // Do not imply a public transport route exists when the catalog has none.
    if (transport === 'transit' && travelMinutesApprox === undefined) continue
    const totalMinutesApprox = travelMinutesApprox === undefined
      ? undefined
      : travelMinutesApprox * 2 + trip.visitMinutes
    if (trip.visitMinutes > request.minutes) continue
    if (totalMinutesApprox !== undefined && totalMinutesApprox > request.minutes) continue

    const cost = sourcedCost(trip)
    if (request.budgetKzt !== undefined && cost && cost.min > request.budgetKzt) continue
    const status = budgetStatus(trip, request.budgetKzt)
    const matchesText = normalizedText.length > 0 && (
      [trip.name, trip.category].some((value) => value.toLocaleLowerCase('ru').split(/\s+/).some((word) =>
        word.length >= 5 && normalizedText.includes(word.slice(0, 5))))
      || (TRIP_KEYWORDS[trip.category] ?? []).some((word) => normalizedText.includes(word))
    )
    const score = (matchesText ? 30 : 0)
      + (totalMinutesApprox !== undefined ? 10 : 0)
      + (status === 'within' ? 8 : 0)
      - (positiveEstimate(trip.travel.roadKmApprox, trip.travel.sourceUrl) ?? 0) * 0.02
    ranked.push({ trip, travelMinutesApprox, totalMinutesApprox, budgetStatus: status, score })
  }
  return ranked.sort((a, b) => b.score - a.score || a.trip.id.localeCompare(b.trip.id))
}

export function toTripRecommendation(candidate: TripCandidate, city: CityCatalog, request: WalkRequest): Recommendation {
  const { trip, travelMinutesApprox, totalMinutesApprox } = candidate
  const language = languageOf(request)
  const transport = request.transport ?? 'car'
  const landmark = city.pois.find((poi) => poi.id === request.landmarkId)
  const start = request.latitude !== undefined && request.longitude !== undefined
    ? { lat: request.latitude, lon: request.longitude }
    : landmark ? { lat: landmark.lat, lon: landmark.lon }
    : city.center
  const durationHint = sourceUrl(trip.durationSourceUrl) && trip.durationClass
    ? pick(language,
      ` Источник предлагает ${trip.durationClass === 'half_day' ? 'план на полдня' : 'план на целый день'}; это не гарантия времени самостоятельной поездки.`,
      ` Дереккөз ${trip.durationClass === 'half_day' ? 'жарты күндік' : 'толық күндік'} жоспарды ұсынады; жеке сапар ұзақтығына кепілдік жоқ.`,
      ` A source suggests ${trip.durationClass === 'half_day' ? 'a half-day' : 'a full-day'} plan; this is not a guarantee for an independent trip.`)
    : ''
  const travel = travelMinutesApprox === undefined
    ? pick(language, `Время дороги туда и обратно не проверено.${durationHint}`,
      `Баруға және қайтуға кететін уақыт тексерілмеген.${durationHint}`,
      `Round-trip travel time has not been verified.${durationHint}`)
    : pick(language,
      `Дорога в одну сторону — ориентировочно ${travelMinutesApprox} мин; туда и обратно с посещением — около ${totalMinutesApprox} мин.`,
      `Бір бағыттағы жол шамамен ${travelMinutesApprox} мин; бару, қайту және аралау жалпы шамамен ${totalMinutesApprox} мин.`,
      `One-way travel is approximately ${travelMinutesApprox} min; the return trip and visit total about ${totalMinutesApprox} min.`)
  const cost = sourcedCost(trip)
  const budget = cost
    ? pick(language,
      `Ориентир затрат: ${cost.min}–${cost.max} ₸ по указанному источнику; проверьте актуальную цену.`,
      `Көрсетілген дереккөз бойынша шығын шамамен ${cost.min}–${cost.max} ₸; өзекті бағаны тексеріңіз.`,
      `Sourced cost estimate: ${cost.min}–${cost.max} ₸; check the current price.`)
    : pick(language, 'Стоимость дороги и посещения не проверена.',
      'Жол мен келу құны тексерілмеген.', 'Travel and admission costs have not been verified.')
  const tripName = language === 'en'
    ? ({ 'osm:way:1465089835': 'ALZHIR Museum', 'osm:node:6522625814': 'Burabay: Bolektau viewpoint',
      'osm:way:1116434315': 'Burabay: Botai Museum' } as Record<string, string>)[trip.id] ?? trip.name
    : language === 'kk'
      ? ({ 'osm:way:1465089835': 'АЛЖИР мұражайы', 'osm:node:6522625814': 'Бурабай: Бөлектау көрініс алаңы',
        'osm:way:1116434315': 'Бурабай: Ботай мұражайы' } as Record<string, string>)[trip.id] ?? trip.name
      : trip.name
  return {
    id: trip.id,
    name: tripName,
    category: trip.category,
    kind: 'trip',
    cityId: city.id,
    lat: trip.lat,
    lon: trip.lon,
    travelMode: transport,
    ...(travelMinutesApprox !== undefined ? { travelMinutesApprox } : {}),
    ...(positiveEstimate(trip.travel.roadKmApprox, trip.travel.sourceUrl) !== undefined
      ? { distanceKmApprox: trip.travel.roadKmApprox } : {}),
    ...(cost ? { estimatedCostKzt: { min: cost.min, max: cost.max } } : {}),
    ...(sourceUrl(trip.travel.sourceUrl) ? { travelSourceUrl: trip.travel.sourceUrl } : {}),
    ...(cost ? { costSourceUrl: cost.sourceUrl } : {}),
    ...(sourceUrl(trip.durationSourceUrl) ? { durationSourceUrl: trip.durationSourceUrl } : {}),
    budgetStatus: candidate.budgetStatus,
    timeStatus: totalMinutesApprox === undefined ? 'unknown' : 'within',
    why: `${travel} ${budget}`,
    action: pick(language,
      'Проверьте состояние дороги, погоду, доступность места и условия посещения перед выездом.',
      'Жолға шықпас бұрын жол жағдайын, ауа райын, орынның қолжетімділігін және келу шарттарын тексеріңіз.',
      'Check road conditions, weather, access and visiting requirements before setting out.'),
    actionSource: 'template',
    visitMinutes: trip.visitMinutes,
    hoursStatus: pick(language, 'Доступность и часы работы не проверены',
      'Қолжетімділік пен жұмыс уақыты тексерілмеген', 'Access and opening hours have not been verified'),
    sourceUrl: `https://www.openstreetmap.org/${trip.osmType}/${trip.osmId}`,
    routeUrl: routeUrl(start, trip, transport),
    approximate: true,
  }
}
