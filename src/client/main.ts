import catalog from '../../data/pois.json'
import type {
  Intent,
  RecommendRequest,
  RecommendResponse,
  Recommendation,
  WalkRequest,
} from '../shared/types'
import './style.css'

interface TelegramLocation {
  latitude: number
  longitude: number
}

interface TelegramLocationManager {
  isLocationAvailable: boolean
  init(callback: () => void): void
  getLocation(callback: (location: TelegramLocation | null) => void): void
}

interface TelegramWebApp {
  initData: string
  colorScheme?: 'light' | 'dark'
  LocationManager?: TelegramLocationManager
  ready(): void
  expand(): void
  isVersionAtLeast?(version: string): boolean
  openLink?(url: string): void
  onEvent?(event: string, callback: () => void): void
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp }
  }
}

type Duration = WalkRequest['minutes']
type LocationChoice = 'zone' | 'device'

const telegram = window.Telegram?.WebApp
const zone = catalog.zone
const app = document.querySelector<HTMLDivElement>('#app')

const categoryLabels: Record<string, string> = {
  cafe: 'Кафе',
  playground: 'Детская площадка',
  theme_park: 'Парк развлечений',
  museum: 'Музей',
  gallery: 'Галерея',
  theatre: 'Театр',
  park: 'Парк',
  garden: 'Сад',
  viewpoint: 'Смотровая точка',
  artwork: 'Арт-объект',
  monument: 'Монумент',
  memorial: 'Мемориал',
  attraction: 'Достопримечательность',
  arts_centre: 'Центр искусств',
  place_of_worship: 'Культовое сооружение',
}

if (!app) throw new Error('Missing application root')

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="Рядом, городской помощник">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-name">рядом<span class="brand-period">.</span></span>
      </div>
      <span class="topbar-city">АСТАНА</span>
    </header>

    <main>
      <section class="intro" aria-labelledby="main-title">
        <p class="eyebrow"><span class="eyebrow-line"></span> ГОРОД ПОД ВАШИ ПЛАНЫ</p>
        <h1 id="main-title">Есть время.<br /><em>Есть куда пойти.</em></h1>
        <p class="intro-copy">Расскажите, где вы и сколько у вас времени. Подберём короткую прогулку с понятным планом. Пока доступен центр вокруг Байтерека.</p>
      </section>

      <form id="planner" class="planner" novalidate>
        <div class="planner-header">
          <div>
            <p class="section-kicker">ВАШ ЗАПРОС</p>
            <h2>С чего начнём?</h2>
          </div>
          <span class="planner-badge">1 минута</span>
        </div>

        <fieldset class="field-group">
          <legend><span class="field-number">01</span> Откуда отправимся?</legend>
          <div class="location-grid">
            <button id="zoneButton" type="button" class="location-option is-selected" data-location="zone" aria-pressed="true">
              <span class="location-option-title">${escapeHtml(zone.name)}</span>
              <span class="location-option-subtitle">Выбрать район</span>
            </button>
            <button id="deviceButton" type="button" class="location-option" data-location="device" aria-pressed="false">
              <span class="location-option-title">Моя геопозиция</span>
              <span class="location-option-subtitle">Найти рядом со мной</span>
            </button>
          </div>
          <p id="locationStatus" class="field-hint" role="status">Можно не делиться геопозицией: район уже выбран.</p>
        </fieldset>

        <fieldset class="field-group">
          <legend><span class="field-number">02</span> Сколько есть времени?</legend>
          <div class="choice-row" id="durationChoices" aria-label="Время на прогулку">
            <button type="button" class="choice-button" data-minutes="30" aria-pressed="false">30 мин</button>
            <button type="button" class="choice-button is-selected" data-minutes="60" aria-pressed="true">1 час</button>
            <button type="button" class="choice-button" data-minutes="120" aria-pressed="false">2 часа</button>
          </div>
          <p class="field-hint">Время включает дорогу до места и посещение; обратный путь не рассчитан.</p>
        </fieldset>

        <fieldset class="field-group">
          <legend><span class="field-number">03</span> Что вам подходит?</legend>
          <div class="choice-row" id="intentChoices" aria-label="Предпочтения">
            <button type="button" class="choice-button intent-button" data-intent="outdoors" aria-pressed="false">На воздухе</button>
            <button type="button" class="choice-button intent-button" data-intent="indoors" aria-pressed="false">В помещении</button>
            <button type="button" class="choice-button intent-button" data-intent="child" aria-pressed="false">С ребёнком</button>
          </div>
        </fieldset>

        <div class="field-group prompt-group">
          <label for="prompt"><span class="field-number">04</span> Добавить пожелание</label>
          <textarea id="prompt" name="prompt" rows="2" maxlength="300" placeholder="Например: хочу парк недалеко от старта"></textarea>
          <p class="field-hint">Можно оставить пустым и выбрать только условия выше.</p>
        </div>

        <button id="submitButton" class="submit-button" type="submit">
          <span class="submit-label">Подобрать прогулку</span>
          <span class="submit-arrow" aria-hidden="true">↗</span>
        </button>
      </form>

      <section id="results" class="results" aria-label="Рекомендации" aria-live="polite">
        <div class="idle-state">
          <span class="idle-rule" aria-hidden="true"></span>
          <p class="section-kicker">ДАЛЬШЕ — ИДЕЯ ДЛЯ ВАС</p>
          <h2>Город ближе,<br />чем кажется.</h2>
          <p>После поиска здесь появятся места и короткий план прогулки.</p>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>${escapeHtml(catalog.source.attribution || '© OpenStreetMap contributors')}</span>
      <span class="footer-links">
        <a href="${escapeHtml(safeUrl(catalog.source.licenseUrl) || 'https://www.openstreetmap.org/copyright')}" target="_blank" rel="noopener noreferrer">Лицензия OSM ↗</a>
        <a href="/privacy.html">О данных</a>
      </span>
    </footer>
  </div>
`

const planner = requiredElement<HTMLFormElement>('#planner')
const results = requiredElement<HTMLElement>('#results')
const prompt = requiredElement<HTMLTextAreaElement>('#prompt')
const submitButton = requiredElement<HTMLButtonElement>('#submitButton')
const submitLabel = requiredElement<HTMLElement>('.submit-label')
const locationStatus = requiredElement<HTMLElement>('#locationStatus')

const state: {
  locationChoice: LocationChoice
  coordinates: TelegramLocation | null
  minutes: Duration
  intents: Set<Intent>
  isLoading: boolean
  hasSearched: boolean
} = {
  locationChoice: 'zone',
  coordinates: null,
  minutes: 60,
  intents: new Set(),
  isLoading: false,
  hasSearched: false,
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

function appendNodes(parent: Element, ...children: Node[]): void {
  children.forEach((child) => parent.appendChild(child))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }
    return replacements[character]
  })
}

function setTheme(): void {
  document.documentElement.dataset.theme = telegram?.colorScheme === 'dark' ? 'dark' : 'light'
}

setTheme()
telegram?.onEvent?.('themeChanged', setTheme)
telegram?.ready()
telegram?.expand()

function setLocation(choice: LocationChoice): void {
  state.locationChoice = choice
  document.querySelectorAll<HTMLButtonElement>('[data-location]').forEach((button) => {
    const selected = button.dataset.location === choice
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
}

function requestDeviceLocation(): void {
  const manager = telegram?.LocationManager
  if (!telegram?.isVersionAtLeast?.('8.0') || !manager) {
    locationStatus.textContent = 'Геопозиция недоступна в этой версии Telegram. Используем выбранный район.'
    setLocation('zone')
    return
  }

  const deviceButton = requiredElement<HTMLButtonElement>('#deviceButton')
  deviceButton.disabled = true
  locationStatus.textContent = 'Запрашиваем геопозицию…'

  manager.init(() => {
    if (!manager.isLocationAvailable) {
      deviceButton.disabled = false
      locationStatus.textContent = 'Устройство не передаёт геопозицию. Используем выбранный район.'
      setLocation('zone')
      return
    }

    manager.getLocation((location) => {
      deviceButton.disabled = false
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        locationStatus.textContent = 'Доступ к геопозиции не получен. Можно продолжить с выбранным районом.'
        setLocation('zone')
        return
      }

      state.coordinates = location
      setLocation('device')
      locationStatus.textContent = 'Готово. Подберём места рядом с вами.'
    })
  })
}

requiredElement<HTMLButtonElement>('#zoneButton').addEventListener('click', () => {
  setLocation('zone')
  locationStatus.textContent = `Выбран район «${zone.name}». Геопозиция не требуется.`
})
requiredElement<HTMLButtonElement>('#deviceButton').addEventListener('click', requestDeviceLocation)

document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach((button) => {
  button.addEventListener('click', () => {
    state.minutes = Number(button.dataset.minutes) as Duration
    document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach((candidate) => {
      const selected = candidate === button
      candidate.classList.toggle('is-selected', selected)
      candidate.setAttribute('aria-pressed', String(selected))
    })
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach((button) => {
  button.addEventListener('click', () => {
    const intent = button.dataset.intent as Intent
    if (state.intents.has(intent)) {
      state.intents.delete(intent)
    } else {
      if (intent === 'outdoors') state.intents.delete('indoors')
      if (intent === 'indoors') state.intents.delete('outdoors')
      state.intents.add(intent)
    }

    document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach((candidate) => {
      const selected = state.intents.has(candidate.dataset.intent as Intent)
      candidate.classList.toggle('is-selected', selected)
      candidate.setAttribute('aria-pressed', String(selected))
    })
  })
})

function makeRequest(): RecommendRequest {
  const request: WalkRequest = {
    minutes: state.minutes,
    intents: [...state.intents],
    text: prompt.value.trim(),
  }

  if (state.locationChoice === 'device' && state.coordinates) {
    request.latitude = state.coordinates.latitude
    request.longitude = state.coordinates.longitude
  } else {
    request.landmarkId = zone.id
  }

  return { initData: telegram?.initData ?? '', request }
}

function setLoading(loading: boolean): void {
  state.isLoading = loading
  submitButton.disabled = loading
  planner.setAttribute('aria-busy', String(loading))
  submitLabel.textContent = loading ? 'Ищем места…' : state.hasSearched ? 'Обновить план' : 'Подобрать прогулку'
}

function showLoading(): void {
  results.innerHTML = `
    <div class="results-heading">
      <p class="section-kicker">СОБИРАЕМ ВАШ ПЛАН</p>
      <h2>Ищем рядом…</h2>
      <p>Проверяем места, время и ваши пожелания.</p>
    </div>
    <div class="skeleton-card" aria-hidden="true">
      <span class="skeleton-line short"></span>
      <span class="skeleton-line wide"></span>
      <span class="skeleton-line medium"></span>
    </div>
  `
}

function showError(message: string): void {
  results.replaceChildren()
  const panel = document.createElement('div')
  panel.className = 'message-state error-state'
  panel.setAttribute('role', 'alert')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'ПОПРОБУЕМ ЕЩЁ РАЗ'
  const heading = document.createElement('h2')
  heading.textContent = 'План пока не собрался'
  const detail = document.createElement('p')
  detail.textContent = message
  appendNodes(panel, kicker, heading, detail)
  results.appendChild(panel)
  scrollToResults()
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function createLink(label: string, url: string, className: string): HTMLAnchorElement | null {
  const safe = safeUrl(url)
  if (!safe) return null
  const link = document.createElement('a')
  link.href = safe
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.className = className
  link.textContent = label
  if (telegram?.initData && telegram.openLink) {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      telegram.openLink?.(safe)
    })
  }
  return link
}

function createCard(item: Recommendation, index: number): HTMLElement {
  const card = document.createElement('article')
  card.className = 'place-card'

  const top = document.createElement('div')
  top.className = 'place-top'
  const number = document.createElement('span')
  number.className = 'place-number'
  number.textContent = String(index + 1).padStart(2, '0')
  const category = document.createElement('span')
  category.className = 'place-category'
  category.textContent = categoryLabels[item.category] || 'Место'
  appendNodes(top, number, category)

  const name = document.createElement('h3')
  name.textContent = item.name

  const why = document.createElement('p')
  why.className = 'place-why'
  why.textContent = item.why

  const action = document.createElement('div')
  action.className = 'place-action'
  const actionLabel = document.createElement('span')
  actionLabel.textContent = item.actionSource === 'ai' ? 'ИДЕЯ ИИ · НЕ ФАКТ О МЕСТЕ' : 'ИДЕЯ НА МЕСТЕ'
  const actionText = document.createElement('p')
  actionText.textContent = item.action
  appendNodes(action, actionLabel, actionText)

  const facts = document.createElement('div')
  facts.className = 'place-facts'
  if (typeof item.walkMinutes === 'number') facts.appendChild(createFact(`≈ ${item.walkMinutes} мин в пути`))
  if (typeof item.visitMinutes === 'number') facts.appendChild(createFact(`≈ ${item.visitMinutes} мин на месте`))
  facts.appendChild(createFact(item.hoursStatus || 'Часы работы не подтверждены', true))

  const links = document.createElement('div')
  links.className = 'place-links'
  const routeLink = createLink('Маршрут во внешней карте ↗', item.routeUrl, 'map-link')
  const sourceLink = createLink('Источник ↗', item.sourceUrl, 'source-link')
  if (routeLink) links.appendChild(routeLink)
  if (sourceLink) links.appendChild(sourceLink)

  appendNodes(card, top, name, why, action, facts, links)
  return card
}

function createFact(value: string, secondary = false): HTMLElement {
  const fact = document.createElement('span')
  fact.className = secondary ? 'fact fact-secondary' : 'fact'
  fact.textContent = value
  return fact
}

function scrollToResults(): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  results.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function showResults(response: RecommendResponse): void {
  results.replaceChildren()

  const heading = document.createElement('div')
  heading.className = 'results-heading'
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = response.recommendations.length ? 'ВАШ ПЛАН' : 'ПОДБЕРЁМ ИНАЧЕ'
  const title = document.createElement('h2')
  title.textContent = response.recommendations.length ? 'Вот что рядом' : 'Подходящих мест пока нет'
  const summary = document.createElement('p')
  summary.textContent = response.summary
  appendNodes(heading, kicker, title, summary)
  results.appendChild(heading)

  if (response.recommendations.length) {
    const list = document.createElement('div')
    list.className = 'place-list'
    response.recommendations.slice(0, 3).forEach((item, index) => list.appendChild(createCard(item, index)))
    results.appendChild(list)

    const mapPrivacy = document.createElement('p')
    mapPrivacy.className = 'map-privacy-note'
    mapPrivacy.textContent = 'При открытии маршрута начальная точка и место назначения передаются картографическому сервису.'
    results.appendChild(mapPrivacy)
  } else {
    const empty = document.createElement('div')
    empty.className = 'message-state empty-state'
    empty.textContent = 'Попробуйте увеличить время, выбрать другой формат или сменить точку отправления.'
    results.appendChild(empty)
  }

  if (response.note) {
    const note = document.createElement('p')
    note.className = 'results-note'
    note.textContent = response.note
    results.appendChild(note)
  }

  const refine = document.createElement('p')
  refine.className = 'refine-hint'
  refine.textContent = 'Хотите иначе? Измените время, формат или пожелание выше и обновите план.'
  results.appendChild(refine)

  state.hasSearched = true
  submitLabel.textContent = 'Обновить план'
  scrollToResults()
}

planner.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (state.isLoading) return

  if (!telegram?.initData) {
    showError('Для рекомендаций откройте приложение через кнопку в Telegram. Здесь можно посмотреть интерфейс и выбрать условия.')
    return
  }

  prompt.blur()
  showLoading()
  setLoading(true)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest()),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Сессия Telegram устарела. Закройте приложение и откройте его снова.')
      }
      throw new Error('Не удалось получить рекомендации. Попробуйте ещё раз через несколько секунд.')
    }

    const data: RecommendResponse = await response.json()
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.recommendations)) {
      throw new Error('Ответ сервера неполный. Попробуйте ещё раз.')
    }
    showResults(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте ещё раз.'
    showError(error instanceof DOMException && error.name === 'AbortError'
      ? 'Поиск занял слишком много времени. Проверьте соединение и попробуйте ещё раз.'
      : message)
  } finally {
    window.clearTimeout(timeout)
    setLoading(false)
  }
})
