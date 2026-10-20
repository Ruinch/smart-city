import { describe, expect, it } from 'vitest'
import { ASTANA_CENTER } from '../shared/astana'
import verifiedSnapshot from '../../data/astana-overture-verified.json'
import osmSnapshot from '../../data/astana-dynamic-fallback.json'
import type { DynamicPlace } from './dynamic'
import { conflictingAddressIds, importVerifiedOverture, sameVenue } from './overture'

const AS_OF = new Date('2026-10-20T12:00:00.000Z')
const FIRST_ID = '4dba5555-1111-4111-8111-000000000001'
const SECOND_ID = '4dba5555-1111-4111-8111-000000000002'

function venue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `overture:${FIRST_ID}`,
    name: 'Тихая чашка', category: 'cafe',
    lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
    address: 'улица Достык 9', confidence: 0.94,
    provider: 'Overture Maps', sourceProvider: 'meta', sourceRecordId: '1234567890',
    sourceLicense: 'CDLA-Permissive-2.0',
    verification: {
      kind: 'official_site', sourceUrl: 'https://quietcup.kz/astana/dostyk-9',
      checkedAt: '2026-10-19T12:00:00.000Z',
      name: 'Тихая чашка', address: 'ул. Достык 9',
      lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
    },
    ...overrides,
  }
}

function snapshot(places: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: { provider: 'Overture Maps Places', release: '2026-09-23.1' },
    places,
    ...overrides,
  }
}

function imported(places: unknown[], existing: DynamicPlace[] = []) {
  return importVerifiedOverture(snapshot(places), existing, AS_OF)
}

describe('verified Overture offline importer', () => {
  it('loads the curated production snapshot without quietly dropping entries', () => {
    const osmPlaces: DynamicPlace[] = osmSnapshot.pois.map((place) => ({
      id: place.id, name: place.name, category: place.category,
      lat: place.lat, lon: place.lon, visitMinutes: place.visitMinutes,
      sourceUrl: place.sourceUrl, provider: 'OpenStreetMap',
      tags: Object.fromEntries(Object.entries(place.tags)
        .filter((pair): pair is [string, string] => typeof pair[1] === 'string')),
    }))
    const result = importVerifiedOverture(verifiedSnapshot, osmPlaces, AS_OF)
    const individuallyRejected = verifiedSnapshot.places.flatMap((place) => {
      const check = importVerifiedOverture(snapshot([place]), [], AS_OF)
      return check.places.length ? [] : [{ name: place.name, rejected: check.rejected }]
    })
    expect(individuallyRejected).toEqual([])
    expect(result.rejected).toEqual({})
    expect(result.places).toHaveLength(verifiedSnapshot.places.length)
    expect(result.places.length).toBeGreaterThan(20)
    expect(result.places.every((place) => place.provider === 'Overture Maps'
      && place.sourceDataset && place.provenance.verificationUrl
      && place.sourceUrl.startsWith('https://explore.overturemaps.org/'))).toBe(true)
    expect(result.places.map((place) => place.name)).toContain('Dark Side Bar')
    expect(result.places.find((place) => place.name === 'Dark Side Bar')
      ?.provenance.coordinateCorrectionMeters).toBeGreaterThan(0)
    expect(JSON.stringify(verifiedSnapshot)).not.toContain('maps.app.goo.gl')
  })

  it('imports independently checked venues with traceable provenance and no invented claims', () => {
    const result = imported([venue()])
    expect(result.rejected).toEqual({})
    expect(result.places).toHaveLength(1)
    const place = result.places[0]
    expect(place).toMatchObject({
      id: `overture:${FIRST_ID}`, category: 'cafe', provider: 'Overture Maps',
      provenance: {
        release: '2026-09-23.1', sourceDataset: 'meta', sourceRecordId: '1234567890',
        sourceLicense: 'CDLA-Permissive-2.0', confidence: 0.94,
        verificationUrl: 'https://quietcup.kz/astana/dostyk-9',
      },
      tags: {
        website: 'https://quietcup.kz/astana/dostyk-9',
        'overture:category': 'cafe', 'addr:full': 'ул. Достык 9',
      },
    })
    expect(place.sourceUrl).toContain(`feature=places.place.${FIRST_ID}`)
    expect(place.tags).not.toHaveProperty('opening_hours')
    expect(place.tags).not.toHaveProperty('fee')
    expect(place.tags).not.toHaveProperty('wheelchair')
  })

  it('never promotes the unverified research candidate file', () => {
    expect(importVerifiedOverture(snapshot([venue()], { candidateOnly: true }), [], AS_OF))
      .toEqual({ places: [], rejected: { invalid_snapshot: 1 } })
    expect(importVerifiedOverture(snapshot([venue()], { schemaVersion: 2 }), [], AS_OF))
      .toEqual({ places: [], rejected: { invalid_snapshot: 1 } })
  })

  it('requires a supported activity, strong confidence, coordinates inside Astana and source lineage', () => {
    const cases = [
      { field: { category: 'car_dealer' }, reason: 'category' },
      { field: { confidence: 0.69 }, reason: 'confidence' },
      { field: { lat: 43.23, lon: 76.9 }, reason: 'location' },
      { field: { sourceProvider: 'mystery' }, reason: 'provenance' },
      { field: { sourceLicense: 'unknown' }, reason: 'provenance' },
      { field: { operatingStatus: 'permanently_closed' }, reason: 'closed' },
      { field: { name: '' }, reason: 'identity' },
      { field: { address: 'Астана' }, reason: 'identity' },
    ]
    for (const { field, reason } of cases) {
      const result = imported([venue(field)])
      expect(result.places, JSON.stringify(field)).toEqual([])
      expect(result.rejected, JSON.stringify(field)).toEqual({ [reason]: 1 })
    }
  })

  it('checks independent branch identity, address, location, freshness and HTTPS source', () => {
    const base = venue()
    const proof = base.verification as Record<string, unknown>
    const cases = [
      { name: 'Different cafe' },
      { address: 'улица Достык 19' },
      { lat: ASTANA_CENTER.lat + 0.01 },
      { checkedAt: '2025-01-01T00:00:00.000Z' },
      { sourceUrl: 'http://quietcup.kz/astana/dostyk-9' },
      { sourceUrl: 'https://127.0.0.1/private' },
      { kind: '2gis_branch', sourceUrl: 'https://quietcup.kz/astana/dostyk-9' },
    ]
    for (const change of cases) {
      const result = imported([venue({ verification: { ...proof, ...change } })])
      expect(result.places, JSON.stringify(change)).toEqual([])
      expect(result.rejected, JSON.stringify(change)).toEqual({ unverified: 1 })
    }
  })

  it('does not call a map listing an official venue website', () => {
    const proof = (venue().verification as Record<string, unknown>)
    const result = imported([venue({ verification: {
      ...proof, kind: 'osm_place', sourceUrl: 'https://www.openstreetmap.org/node/123',
    } })])
    expect(result.places).toHaveLength(1)
    expect(result.places[0].tags.website).toBeUndefined()
  })

  it('accepts an OSM street-address check without pretending OSM verified the venue name', () => {
    const result = imported([venue({ verification: {
      kind: 'osm_address', sourceUrl: 'https://www.openstreetmap.org/way/9876',
      checkedAt: '2026-10-20T06:40:00Z',
      address: 'Достык 9', street: 'Достык', houseNumber: '9',
      lat: ASTANA_CENTER.lat + 0.0004, lon: ASTANA_CENTER.lon,
    } })])
    expect(result.rejected).toEqual({})
    expect(result.places).toHaveLength(1)
    expect(result.places[0].lat).toBe(ASTANA_CENTER.lat)
    expect(result.places[0].tags).toMatchObject({
      'addr:street': 'Достык', 'addr:housenumber': '9',
    })
    expect(result.places[0].tags).not.toHaveProperty('website')
    expect(result.places[0].provenance.verificationKind).toBe('osm_address')
    expect(result.places[0].provenance.verificationDistanceMeters).toBeGreaterThan(0)
  })

  it('rejects OSM address checks with a different house, malformed source or excessive drift', () => {
    const base = {
      kind: 'osm_address', sourceUrl: 'https://www.openstreetmap.org/node/123',
      checkedAt: '2026-10-20T06:40:00Z',
      address: 'Достык 9', street: 'Достык', houseNumber: '9',
      lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
    }
    for (const change of [
      { address: 'Достык 19', houseNumber: '19' },
      { sourceUrl: 'https://www.openstreetmap.org/user/123' },
      { lat: ASTANA_CENTER.lat + 0.002 },
      { houseNumber: '19' },
    ]) {
      const result = imported([venue({ verification: { ...base, ...change } })])
      expect(result.places, JSON.stringify(change)).toEqual([])
      expect(result.rejected, JSON.stringify(change)).toEqual({ unverified: 1 })
    }
  })

  it('uses a nearby independent official map pin and accepts a same-building address alias', () => {
    const proof = venue().verification as Record<string, unknown>
    const result = imported([venue({
      address: 'Мәңгілік Ел даңғылы 52а',
      verification: {
        ...proof, address: 'проспект Мәңгілік Ел 52/1',
        lat: ASTANA_CENTER.lat + 0.0002,
      },
    })])
    expect(result.places).toHaveLength(1)
    expect(result.places[0].lat).toBe(ASTANA_CENTER.lat + 0.0002)
    expect(result.places[0].provenance).toMatchObject({
      sourceLat: ASTANA_CENTER.lat,
      verifiedAddress: 'проспект Мәңгілік Ел 52/1',
      coordinateCorrectionMeters: expect.any(Number),
    })
    expect(result.places[0].tags['addr:full']).toBe('проспект Мәңгілік Ел 52/1')
    expect(imported([venue({
      address: 'Мәңгілік Ел даңғылы 52а',
      verification: { ...proof, address: 'проспект Мәңгілік Ел 52/1',
        lat: ASTANA_CENTER.lat + 0.0015 },
    })]).rejected).toEqual({ unverified: 1 })
  })

  it('quarantines every candidate at a scattered repeated street address', () => {
    const second = venue({
      id: `overture:${SECOND_ID}`, name: 'Другой бар', category: 'bar',
      lat: ASTANA_CENTER.lat + 0.06,
    })
    expect(conflictingAddressIds([venue(), second])).toEqual(new Set([FIRST_ID, SECOND_ID]))
    const result = imported([venue(), second])
    expect(result.places).toEqual([])
    expect(result.rejected).toEqual({ address_conflict: 2 })
  })

  it('deduplicates nearby existing OSM places and duplicate Overture branches', () => {
    const osm: DynamicPlace = {
      id: 'osm:node:42', name: 'Тихая чашка', category: 'cafe',
      lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
      visitMinutes: 45, sourceUrl: 'https://www.openstreetmap.org/node/42',
      provider: 'OpenStreetMap', tags: {},
    }
    expect(imported([venue()], [osm])).toEqual({ places: [], rejected: { duplicate: 1 } })
    const second = venue({ id: `overture:${SECOND_ID}`, lat: ASTANA_CENTER.lat + 0.0002 })
    const result = imported([venue(), second])
    expect(result.places).toHaveLength(1)
    expect(result.rejected).toEqual({ duplicate: 1 })
    expect(sameVenue(osm, { ...osm, lat: ASTANA_CENTER.lat + 0.04 })).toBe(false)
  })
})
