import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Poi } from '../shared/types'
import { chooseWithAI } from './ai'

afterEach(() => vi.restoreAllMocks())

describe('bounded AI ranking', () => {
  it('sends one structured request without Telegram ID or exact coordinates', async () => {
    const poi: Poi = {
      id: 'osm:node:123', name: 'Тестовый парк', category: 'park',
      description: 'Парк по категории OSM в центре Астаны.', descriptionSource: 'category_template',
      lat: 51.128, lon: 71.43, visitMinutes: 15,
      sourceUrl: 'https://www.openstreetmap.org/node/123', osmType: 'node', osmId: 123, tags: {},
    }
    let sent: Record<string, unknown> | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
          choices: [{ id: poi.id, reason: 'theme', action: 'open_route', idea: 'Прогуляйтесь неспешно и выберите любимый ракурс.' }],
        }) }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const selections = await chooseWithAI('test-api-key', {
      latitude: 51.128, longitude: 71.43, minutes: 30, intents: ['outdoors'], text: 'Хочу парк',
    }, [{ poi, walkMinutes: 3, visitMinutes: 15, score: 10 }])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent?.model).toBe('gpt-6-luna')
    expect(JSON.stringify(sent)).toContain('Хочу парк')
    expect(JSON.stringify(sent)).toContain(poi.description)
    expect(JSON.stringify(sent)).not.toContain('51.128')
    expect(JSON.stringify(sent)).not.toContain('71.43')
    expect(JSON.stringify(sent)).not.toContain('latitude')
    expect(selections).toEqual([{ id: poi.id, reason: 'theme', action: 'open_route', idea: 'Прогуляйтесь неспешно и выберите любимый ракурс.' }])
  })
})
