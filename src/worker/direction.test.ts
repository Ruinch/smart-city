import { describe, expect, it } from 'vitest'
import { ASTANA_CENTER } from '../shared/astana'
import { cityDirectionScore, directionMetrics, onCityHeading, onTripHeading } from './direction'

describe('rough route heading', () => {
  it('keeps city places ahead of the start and near the selected corridor', () => {
    const target = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .08 }
    const ahead = { lat: ASTANA_CENTER.lat + .002, lon: ASTANA_CENTER.lon + .04 }
    const behind = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon - .02 }
    const sideTrip = { lat: ASTANA_CENTER.lat + .04, lon: ASTANA_CENTER.lon + .04 }
    expect(onCityHeading(ASTANA_CENTER, target, ahead, 'walk')).toBe(true)
    expect(onCityHeading(ASTANA_CENTER, target, behind, 'walk')).toBe(false)
    expect(onCityHeading(ASTANA_CENTER, target, sideTrip, 'walk')).toBe(false)
    expect(directionMetrics(ASTANA_CENTER, target, ahead)?.progress).toBeCloseTo(.5, 1)
    expect(cityDirectionScore(ASTANA_CENTER, target, ahead, 'walk'))
      .toBeGreaterThan(cityDirectionScore(ASTANA_CENTER, target, sideTrip, 'walk'))
  })

  it('treats a near-identical target as no useful heading and rejects opposite out-of-city travel', () => {
    const close = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .001 }
    expect(directionMetrics(ASTANA_CENTER, close, ASTANA_CENTER)).toBeNull()
    const east = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + 1 }
    const west = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon - 1 }
    expect(onTripHeading(ASTANA_CENTER, east, east)).toBe(true)
    expect(onTripHeading(ASTANA_CENTER, east, west)).toBe(false)
  })
})
