import { describe, expect, it } from 'vitest'
import type { LiveEvent, WalkRequest } from '../shared/types'
import { selectLiveEvents, wantsLiveEvents } from './event-selection'

const now = new Date('2026-10-20T18:30:00Z') // 23:30 in Astana
const request: WalkRequest = { text: 'Какие концерты в Астане?', minutes: 120,
  intents: [], scope: 'city', includeEvents: true }

function event(id: string, startsAt: string, overrides: Partial<LiveEvent> = {}): LiveEvent {
  return { id, title: `Событие ${id}`, category: 'concert', startsAt,
    venueName: 'ЦКЗ «Qazaqstan»', sourceUrl: `https://qazaqconcert.kz/ru/poster/${id}`,
    sourceName: 'Қазақконцерт', checkedAt: now.toISOString(), ...overrides }
}

describe('dated event selection', () => {
  it('recognizes explicit event requests and leaves ordinary walks untouched', () => {
    expect(wantsLiveEvents(request)).toBe(true)
    expect(wantsLiveEvents({ ...request, text: 'Хочу прогуляться', includeEvents: false })).toBe(false)
    expect(wantsLiveEvents({ ...request, scope: 'day_trip' })).toBe(false)
    expect(wantsLiveEvents({ ...request, includeEvents: false, text: 'Хочу на выставку' })).toBe(true)
  })

  it('keeps only matching current and upcoming dated listings, including the local day rollover', () => {
    const result = selectLiveEvents([
      event('past', '2026-10-20T20:00:00+05:00'),
      event('today-date-only', '2026-10-20'),
      event('tomorrow', '2026-10-21'),
      event('festival', '2026-10-22', { category: 'festival' }),
      event('far-future', '2027-01-01'),
      event('invalid', '2026-02-30'),
    ], request, now)
    expect(result.map((item) => item.id)).toEqual(['today-date-only', 'tomorrow'])
  })

  it('honors an explicit today or tomorrow request without guessing a date-only start hour', () => {
    const items = [event('today', '2026-10-20'), event('tomorrow', '2026-10-21')]
    expect(selectLiveEvents(items, { ...request, text: 'Концерт сегодня' }, now)
      .map((item) => item.id)).toEqual(['today'])
    expect(selectLiveEvents(items, { ...request, text: 'Концерт завтра' }, now)
      .map((item) => item.id)).toEqual(['tomorrow'])
  })

  it('does not assert that an unknown ticket price is free or wheelchair accessible', () => {
    const events = [
      event('unknown', '2026-10-21'),
      event('free', '2026-10-21', { priceKzt: 0, placeId: 'osm:node:1' }),
      event('paid', '2026-10-21', { priceKzt: 4000, placeId: 'osm:node:2' }),
    ]
    expect(selectLiveEvents(events, { ...request, budgetKzt: 0 }, now).map((item) => item.id)).toEqual(['free'])
    expect(selectLiveEvents(events, { ...request, accessibility: 'osm_wheelchair_yes' }, now).map((item) => item.id)).toEqual([])
    expect(selectLiveEvents(events, { ...request, accessibility: 'osm_wheelchair_yes' }, now,
      new Set(['osm:node:1'])).map((item) => item.id)).toEqual(['free'])
  })

  it('drops events whose published end time already passed', () => {
    const items = [
      event('finished', '2026-10-20T17:00:00+05:00', { endsAt: '2026-10-20T22:00:00+05:00' }),
      event('ongoing', '2026-10-20T21:00:00+05:00', { endsAt: '2026-10-21T01:00:00+05:00' }),
    ]
    expect(selectLiveEvents(items, request, now).map((item) => item.id)).toEqual(['ongoing'])
  })
})
