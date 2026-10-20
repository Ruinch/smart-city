import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalkRequest } from '../shared/types'
import type { DynamicPlace } from './dynamic'
import { needsWebEvidence, searchVenueEvidence } from './web-evidence'

const request: WalkRequest = {
  cityId: 'astana', scope: 'city', transport: 'walk', minutes: 120,
  intents: [], text: 'Тихое кафе, чтобы почитать',
}

function venue(id: string, name: string): DynamicPlace {
  return { id, name, category: 'cafe', lat: 51.1282, lon: 71.4304,
    visitMinutes: 45, sourceUrl: 'https://www.openstreetmap.org/node/1',
    tags: {}, provider: 'OpenStreetMap' }
}

function stubSearch(id: string, title: string, snippet: string) {
  const url = `https://example.org/astana/${id}`
  const payload = {
    status: 'completed',
    output: [
      { type: 'web_search_call', action: { sources: [{ url, title, snippet }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        findings: [{ id, feature: 'quiet', sourceUrl: url }],
      }) }] },
    ],
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })))
}

afterEach(() => vi.unstubAllGlobals())

describe('optional web evidence', () => {
  it('does not spend a paid search for a plain venue category or book request', () => {
    expect(needsWebEvidence('Хочу ночной клуб')).toBe(false)
    expect(needsWebEvidence('Кофе и книги')).toBe(false)
    expect(needsWebEvidence('Тихое кафе с розетками')).toBe(true)
  })

  it('rejects a model claim when the source only names the venue', async () => {
    const place = venue('osm:node:1001', 'Atlas Garden Cafe')
    stubSearch(place.id, 'Atlas Garden Cafe Astana', 'Atlas Garden Cafe in Astana')
    expect(await searchVenueEvidence('test-key', request, [place])).toEqual([])
  })

  it('accepts a property only when the same venue source explicitly describes it', async () => {
    const place = venue('osm:node:1002', 'Orion Reading Cafe')
    stubSearch(place.id, 'Orion Reading Cafe Astana', 'A quiet reading corner at Orion Reading Cafe.')
    const findings = await searchVenueEvidence('test-key', request, [place])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ id: place.id, feature: 'quiet' })
    expect(findings[0].sourceUrl).toMatch(/^https:\/\//)
    const searchBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(searchBody.max_tool_calls).toBe(1)
  })
})
