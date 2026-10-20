import { describe, expect, it } from 'vitest'
import { fetchLiveEvents, fetchLiveEventsWithStatus } from './live-events'

const concertHtml = `
<div class="concert__card 2026-00-28">
  <a href="/ru/poster/muzyka-na-vse-vremena" class="concert__caption">«МУЗЫКА НА ВСЕ ВРЕМЕНА»</a>
  <span class="concert__date ">Дата: 28.10.2026</span>
  <span class="concert__time">Время: 19:00</span>
  <div class="concert__hall">Зал: Большой зал</div>
</div>
<div class="concert__card 2026-00-29">
  <a href="/ru/poster/gastrol-v-almaty" class="concert__caption">Гастроли в Алматы</a>
  <span class="concert__date ">Дата: 29.10.2026</span>
  <span class="concert__time">Время: 19:00</span>
  <div class="concert__hall">Зал: Алматы театр</div>
</div>
<div class="concert__card 2026-00-31">
  <a href="https://evil.example/event" class="concert__caption">Внешняя ссылка</a>
  <span class="concert__date ">Дата: 31.10.2026</span>
  <span class="concert__time">Время: 19:00</span>
  <div class="concert__hall">Зал: Камерный зал</div>
</div>`

const tourismHtml = `
<div class="events__item item1">
  <span class="events__item-location">МВЦ EXPO</span>
  <span class="events__item-date">28-29 октября 2026</span>
  <h3 class="events__item-title">United Medical Expo</h3>
  <div class="events__item-text">Международная выставка медицины</div>
</div>
<div class="events__item item2">
  <span class="events__item-location">бассейн «Барыс Арена»</span>
  <span class="events__item-date">15-17 октября 2026</span>
  <h3 class="events__item-title">Кубок мира по плаванию</h3>
</div>
<div class="events__loader"></div>`

const barysHtml = `
<article class="champ-match champ-match--bg">
  <span class="ma-team__name text-running"><span>Барыс</span></span>
  <span class="ma-team__city">Астана</span>
  <time class="ma-date" datetime="2026-11-12T19:30:00+05:00"></time>
  <span class="ma-team__name text-running"><span>Адмирал</span></span>
  <span class="ma-team__city">Владивосток</span>
  <a href="/championship/matches/70870/?teamId=7">Перейти к матчу</a>
</article>
<article class="champ-match champ-match--bg">
  <span class="ma-team__name text-running"><span>Адмирал</span></span>
  <span class="ma-team__city">Владивосток</span>
  <time class="ma-date" datetime="2026-11-13T19:30:00+05:00"></time>
  <span class="ma-team__name text-running"><span>Барыс</span></span>
  <span class="ma-team__city">Астана</span>
  <a href="/championship/matches/70871/?teamId=7">Перейти к матчу</a>
</article>`

function fixtureFetcher(concert = concertHtml, tourism = tourismHtml, barys = barysHtml): typeof fetch {
  return (async (url: RequestInfo | URL) => new Response(
    String(url).includes('qazaqconcert.kz') ? concert
      : String(url).includes('astanatourism.kz') ? tourism : barys,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )) as typeof fetch
}

describe('live Astana events', () => {
  const now = new Date('2026-10-20T09:00:00Z')

  it('reads dated primary-source concerts and exhibitions, without inventing prices or coordinates', async () => {
    const status = await fetchLiveEventsWithStatus({ now, fetcher: fixtureFetcher() })
    expect(status.checkedSources).toEqual(['Қазақконцерт', 'Astana Tourism', 'ХК «Барыс»'])
    expect(status.failedSources).toEqual([])
    expect(status.events).toHaveLength(3)
    expect(status.events.find((event) => event.sourceName === 'Қазақконцерт')).toMatchObject({
      title: '«МУЗЫКА НА ВСЕ ВРЕМЕНА»', category: 'concert',
      startsAt: '2026-10-28T19:00:00+05:00', venueName: 'ЦКЗ «Qazaqstan», Большой зал',
      sourceUrl: 'https://qazaqconcert.kz/ru/poster/muzyka-na-vse-vremena',
      sourceName: 'Қазақконцерт', checkedAt: now.toISOString(),
    })
    expect(status.events.find((event) => event.sourceName === 'Astana Tourism')).toMatchObject({
      title: 'United Medical Expo', category: 'exhibition', startsAt: '2026-10-28',
      endsAt: '2026-10-29', venueName: 'МВЦ EXPO',
      sourceUrl: 'https://astanatourism.kz/ru/events-ru',
    })
    expect(status.events.find((event) => event.sourceName === 'ХК «Барыс»')).toMatchObject({
      title: 'Барыс — Адмирал', category: 'sport', startsAt: '2026-11-12T19:30:00+05:00',
      venueName: 'Барыс Арена', sourceUrl: 'https://ru.hcbarys.kz/championship/matches/70870/',
    })
    expect(status.events.every((event) => event.priceKzt === undefined && event.lat === undefined)).toBe(true)
  })

  it('keeps an ongoing date-only range, but drops it after its last day', async () => {
    const during = await fetchLiveEvents({ now: new Date('2026-10-29T08:00:00Z'), fetcher: fixtureFetcher() })
    expect(during.map((event) => event.title)).toContain('United Medical Expo')
    const after = await fetchLiveEvents({ now: new Date('2026-10-29T20:00:00Z'), fetcher: fixtureFetcher() })
    expect(after.map((event) => event.title)).not.toContain('United Medical Expo')
  })

  it('drops stale, undated, out-of-city and foreign-link records', async () => {
    const events = await fetchLiveEvents({ now, fetcher: fixtureFetcher() })
    expect(events.map((event) => event.title)).not.toContain('Гастроли в Алматы')
    expect(events.map((event) => event.title)).not.toContain('Внешняя ссылка')
    expect(events.map((event) => event.title)).not.toContain('Кубок мира по плаванию')
    expect(events.map((event) => event.title)).not.toContain('Адмирал — Барыс')
  })

  it('reports a source outage separately from an empty schedule', async () => {
    const fetcher = (async (url: RequestInfo | URL) => {
      if (String(url).includes('qazaqconcert.kz')) throw new Error('source unavailable')
      return new Response(String(url).includes('astanatourism.kz') ? tourismHtml : barysHtml,
        { headers: { 'content-type': 'text/html' } })
    }) as typeof fetch
    const status = await fetchLiveEventsWithStatus({ now, fetcher })
    expect(status.failedSources).toEqual(['Қазақконцерт'])
    expect(status.checkedSources).toEqual(['Astana Tourism', 'ХК «Барыс»'])
    expect(status.events).toHaveLength(2)
  })

  it('limits the horizon to the coming 45 days', async () => {
    const html = concertHtml.replaceAll('28.10.2026', '12.12.2026')
    const events = await fetchLiveEvents({ now, fetcher: fixtureFetcher(html, '', '') })
    expect(events).toEqual([])
  })

  it('excludes an event explicitly marked cancelled', async () => {
    const concert = concertHtml.replace('«МУЗЫКА НА ВСЕ ВРЕМЕНА»', '«МУЗЫКА НА ВСЕ ВРЕМЕНА» — отменено')
    const tourism = tourismHtml.replace('Международная выставка медицины', 'Международная выставка медицины — отменено')
    expect(await fetchLiveEvents({ now, fetcher: fixtureFetcher(concert, tourism, '') })).toEqual([])
  })

  it.skipIf(process.env.LIVE_EVENTS_SMOKE !== '1')('reads at least one current event from public organizer pages', async () => {
    const status = await fetchLiveEventsWithStatus({ now: new Date() })
    expect(status.checkedSources).toContain('Қазақконцерт')
    expect(status.checkedSources).toContain('Astana Tourism')
    expect(status.checkedSources).toContain('ХК «Барыс»')
    expect(status.events.length).toBeGreaterThan(0)
    expect(status.events.some((event) => event.sourceName === 'Қазақконцерт')).toBe(true)
    expect(status.events.some((event) => event.sourceName === 'Astana Tourism')).toBe(true)
    expect(status.events.some((event) => event.sourceName === 'ХК «Барыс»')).toBe(true)
  })
})
