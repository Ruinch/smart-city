import './map.css'

export interface MapMarker {
  id: string
  name: string
  lat: number
  lon: number
  kind?: string
  category?: string
  sourceUrl?: string
}

export interface MapCoordinate {
  lat: number
  lon: number
}

export type MapLanguage = 'ru' | 'kk' | 'en'

export interface RecommendationsMapOptions {
  markers: MapMarker[]
  language?: MapLanguage
  center?: MapCoordinate
  routeLine?: MapCoordinate[]
  schematic?: boolean
  onSelect?: (id: string) => void
}

export interface RecommendationsMapController {
  update(markers: MapMarker[], center?: MapCoordinate, routeLine?: MapCoordinate[], schematic?: boolean): void
  select(id: string): void
  focus(point: MapCoordinate): void
  fit(): void
  setBottomInset(px: number): void
  setLanguage(language: MapLanguage): void
  destroy(): void
}

interface MapCopy {
  root: string
  viewport: string
  zoomIn: string
  zoomOut: string
  fitAll: string
  fitCity: string
  fitAllLabel: string
  fitCityLabel: string
  failure: string
  stops: string
  mapPoints: string
  attribution: string
  selected: (name: string) => string
  selectPrompt: string
  showTrip: (name: string) => string
  showStop: (name: string) => string
  noPins: string
  clusterOpen: (count: number) => string
  clusterZoom: (count: number) => string
}

const MAP_COPY: Record<MapLanguage, MapCopy> = {
  ru: {
    root: 'Карта Астаны и маршрута', viewport: 'Карта. Стрелки передвигают её, плюс и минус меняют масштаб.',
    zoomIn: 'Приблизить карту', zoomOut: 'Отдалить карту', fitAll: 'Все', fitCity: 'Астана',
    fitAllLabel: 'Показать весь маршрут', fitCityLabel: 'Вернуться к Астане',
    failure: 'Часть карты не загрузилась. Остановки маршрута остаются в панели.',
    stops: 'Остановки маршрута', mapPoints: 'Точки на карте',
    attribution: '© участники OpenStreetMap',
    selected: (name) => `Выбрано: ${name}`, selectPrompt: 'Выберите точку на карте или в списке.',
    showTrip: (name) => `Показать поездку: ${name}`, showStop: (name) => `Показать остановку: ${name}`,
    noPins: 'На карте пока нет точек.',
    clusterOpen: (count) => `Открыть группу из ${count} точек`,
    clusterZoom: (count) => `Приблизить группу из ${count} точек`,
  },
  kk: {
    root: 'Астана мен маршрут картасы', viewport: 'Карта. Көрсеткілермен жылжытыңыз, плюс пен минус арқылы масштабты өзгертіңіз.',
    zoomIn: 'Картаны жақындату', zoomOut: 'Картаны алыстату', fitAll: 'Бәрі', fitCity: 'Астана',
    fitAllLabel: 'Маршрутты толық көрсету', fitCityLabel: 'Астанаға оралу',
    failure: 'Картаның бір бөлігі жүктелмеді. Маршрут аялдамалары панельде бар.',
    stops: 'Маршрут аялдамалары', mapPoints: 'Картадағы нүктелер',
    attribution: '© OpenStreetMap қатысушылары',
    selected: (name) => `Таңдалды: ${name}`, selectPrompt: 'Картадан немесе тізімнен нүктені таңдаңыз.',
    showTrip: (name) => `Сапарды көрсету: ${name}`, showStop: (name) => `Аялдаманы көрсету: ${name}`,
    noPins: 'Картада әзірге нүктелер жоқ.',
    clusterOpen: (count) => `${count} нүктеден тұратын топты ашу`,
    clusterZoom: (count) => `${count} нүктеден тұратын топты жақындату`,
  },
  en: {
    root: 'Astana and route map', viewport: 'Map. Use arrow keys to move and plus or minus to zoom.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitAll: 'All', fitCity: 'Astana',
    fitAllLabel: 'Show the full route', fitCityLabel: 'Return to Astana',
    failure: 'Some map tiles did not load. Route stops remain in the panel.',
    stops: 'Route stops', mapPoints: 'Map points',
    attribution: '© OpenStreetMap contributors',
    selected: (name) => `Selected: ${name}`, selectPrompt: 'Choose a point on the map or in the list.',
    showTrip: (name) => `Show trip: ${name}`, showStop: (name) => `Show stop: ${name}`,
    noPins: 'No points on the map yet.',
    clusterOpen: (count) => `Open group of ${count} points`,
    clusterZoom: (count) => `Zoom to group of ${count} points`,
  },
}

const TILE_SIZE = 256
const MIN_ZOOM = 5
const MAX_ZOOM = 18
const MAX_FIT_ZOOM = 15
const MAX_LATITUDE = 85.05112878
const OSM_TILE_BASE = 'https://tile.openstreetmap.org/'
const ASTANA_CENTER: MapCoordinate = { lat: 51.1283, lon: 71.4305 }
const CITY_ZOOM = 12

interface Pixel {
  x: number
  y: number
}

function validCoordinate(value: MapCoordinate | undefined): value is MapCoordinate {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180
}

function cleanMarkers(markers: MapMarker[]): MapMarker[] {
  const seen = new Set<string>()
  return markers.filter((marker) => {
    if (!marker || typeof marker.id !== 'string' || !marker.id
      || typeof marker.name !== 'string' || !marker.name
      || !validCoordinate(marker) || seen.has(marker.id)) return false
    seen.add(marker.id)
    return true
  })
}

function cleanRouteLine(points: MapCoordinate[] | undefined): MapCoordinate[] {
  const valid = (points ?? []).filter(validCoordinate)
  const limit = 1500
  if (valid.length <= limit) return valid
  return Array.from({ length: limit }, (_, index) =>
    valid[Math.round(index * (valid.length - 1) / (limit - 1))])
}

function project(point: MapCoordinate, zoom: number): Pixel {
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat))
  const sine = Math.sin(latitude * Math.PI / 180)
  const world = TILE_SIZE * 2 ** zoom
  return {
    x: (point.lon + 180) / 360 * world,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world,
  }
}

function unproject(pixel: Pixel, zoom: number): MapCoordinate {
  const world = TILE_SIZE * 2 ** zoom
  const latitudeRadians = Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel.y / world)))
  const longitude = ((pixel.x / world * 360) % 360 + 360) % 360 - 180
  return {
    lat: latitudeRadians * 180 / Math.PI,
    lon: longitude,
  }
}

function makeButton(className: string, label: string, visibleText: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.textContent = visibleText
  return button
}

/**
 * Mounts a small, token-free OSM map. The caller owns API requests and synchronizes
 * result cards with the returned select method. Tiles are loaded only for the visible
 * viewport, with the browser's normal cache and a visible OSM attribution link.
 */
export function mountRecommendationsMap(
  container: HTMLElement,
  options: RecommendationsMapOptions,
): RecommendationsMapController {
  let language: MapLanguage = options.language ?? 'ru'
  const copy = () => MAP_COPY[language]
  const root = document.createElement('section')
  root.className = 'rec-map'
  root.lang = language
  root.setAttribute('aria-label', copy().root)

  const viewport = document.createElement('div')
  viewport.className = 'rec-map__viewport'
  viewport.tabIndex = 0
  viewport.setAttribute('role', 'group')
  viewport.setAttribute('aria-label', copy().viewport)

  const tileLayer = document.createElement('div')
  tileLayer.className = 'rec-map__tiles'
  tileLayer.setAttribute('aria-hidden', 'true')
  const routeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  routeSvg.classList.add('rec-map__route')
  routeSvg.setAttribute('aria-hidden', 'true')
  const routeHalo = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  routeHalo.classList.add('rec-map__route-halo')
  const routePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  routePath.classList.add('rec-map__route-path')
  const routeStart = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  routeStart.classList.add('rec-map__route-start')
  routeStart.setAttribute('r', '6')
  routeSvg.appendChild(routeHalo)
  routeSvg.appendChild(routePath)
  routeSvg.appendChild(routeStart)
  const markerLayer = document.createElement('div')
  markerLayer.className = 'rec-map__markers'
  const clusterLayer = document.createElement('div')
  clusterLayer.className = 'rec-map__clusters'
  const controlLayer = document.createElement('div')
  controlLayer.className = 'rec-map__controls'
  const zoomIn = makeButton('rec-map__control', copy().zoomIn, '+')
  const zoomOut = makeButton('rec-map__control', copy().zoomOut, '−')
  const fitButton = makeButton('rec-map__control rec-map__control-fit', copy().fitAllLabel, copy().fitAll)
  controlLayer.appendChild(zoomIn)
  controlLayer.appendChild(zoomOut)
  controlLayer.appendChild(fitButton)

  const failure = document.createElement('p')
  failure.className = 'rec-map__failure'
  failure.setAttribute('role', 'status')
  failure.hidden = true
  failure.textContent = copy().failure

  const attribution = document.createElement('a')
  attribution.className = 'rec-map__attribution'
  attribution.href = 'https://www.openstreetmap.org/copyright'
  attribution.target = '_blank'
  attribution.rel = 'noopener noreferrer'
  attribution.textContent = copy().attribution

  viewport.appendChild(tileLayer)
  viewport.appendChild(routeSvg)
  viewport.appendChild(markerLayer)
  viewport.appendChild(clusterLayer)
  viewport.appendChild(controlLayer)
  viewport.appendChild(failure)
  viewport.appendChild(attribution)

  const selectedLine = document.createElement('p')
  selectedLine.className = 'rec-map__selected'
  selectedLine.setAttribute('role', 'status')
  const fallbackDetails = document.createElement('details')
  fallbackDetails.className = 'rec-map__details'
  const fallbackSummary = document.createElement('summary')
  fallbackSummary.textContent = copy().stops
  const fallbackList = document.createElement('nav')
  fallbackList.className = 'rec-map__list'
  fallbackList.setAttribute('aria-label', copy().mapPoints)
  fallbackDetails.appendChild(fallbackSummary)
  fallbackDetails.appendChild(fallbackList)

  root.appendChild(viewport)
  root.appendChild(selectedLine)
  root.appendChild(fallbackDetails)
  container.replaceChildren(root)

  let markers = cleanMarkers(options.markers)
  let routeLine = cleanRouteLine(options.routeLine)
  let schematic = options.schematic ?? true
  let preferredCenter = validCoordinate(options.center) ? options.center : undefined
  let center: MapCoordinate = preferredCenter ?? markers[0] ?? ASTANA_CENTER
  let zoom = CITY_ZOOM
  let selectedId = ''
  let resizedAfterInteraction = false
  let bottomInset = 0
  let frame = 0
  let destroyed = false
  let activePointer: number | null = null
  let lastPointer: Pixel | null = null
  const tiles = new Map<string, HTMLImageElement>()
  const markerButtons = new Map<string, HTMLButtonElement>()
  const listButtons = new Map<string, HTMLButtonElement>()

  function applyLanguage(): void {
    root.lang = language
    root.setAttribute('aria-label', copy().root)
    viewport.setAttribute('aria-label', copy().viewport)
    zoomIn.setAttribute('aria-label', copy().zoomIn)
    zoomOut.setAttribute('aria-label', copy().zoomOut)
    failure.textContent = copy().failure
    attribution.textContent = copy().attribution
    fallbackList.setAttribute('aria-label', copy().mapPoints)
    rebuildMarkerControls()
    queueRender()
  }

  function viewportSize(): { width: number; height: number } {
    return {
      width: Math.max(1, viewport.clientWidth),
      height: Math.max(1, viewport.clientHeight),
    }
  }

  function effectiveBottomInset(height: number): number {
    return Math.min(bottomInset, Math.max(0, height - 80))
  }

  function visibleHeight(height: number): number {
    return height - effectiveBottomInset(height)
  }

  function mapAnchorY(height: number): number {
    return visibleHeight(height) / 2
  }

  function fitMarkers(): void {
    const points: MapCoordinate[] = [...markers, ...routeLine]
    if (preferredCenter) points.push(preferredCenter)
    if (markers.length === 0 && routeLine.length === 0) {
      center = preferredCenter ?? ASTANA_CENTER
      zoom = CITY_ZOOM
      queueRender()
      return
    }
    if (points.length === 0) return
    const { width, height } = viewportSize()
    const availableWidth = Math.max(80, width - 88)
    const availableHeight = Math.max(80, visibleHeight(height) - 88)
    for (let candidateZoom = MAX_FIT_ZOOM; candidateZoom >= MIN_ZOOM; candidateZoom -= 1) {
      const projected = points.map((point) => project(point, candidateZoom))
      const xs = projected.map((point) => point.x)
      const ys = projected.map((point) => point.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      if (candidateZoom === MIN_ZOOM
        || (maxX - minX <= availableWidth && maxY - minY <= availableHeight)) {
        zoom = candidateZoom
        center = unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, zoom)
        break
      }
    }
    queueRender()
  }

  function queueRender(): void {
    if (destroyed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }

  function renderTiles(centerPixel: Pixel, width: number, height: number): void {
    const left = centerPixel.x - width / 2
    const top = centerPixel.y - mapAnchorY(height)
    const startX = Math.floor(left / TILE_SIZE)
    const endX = Math.floor((left + width - 1) / TILE_SIZE)
    const startY = Math.floor(top / TILE_SIZE)
    const endY = Math.floor((top + height - 1) / TILE_SIZE)
    const tileCount = 2 ** zoom
    const visible = new Set<string>()

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        if (y < 0 || y >= tileCount) continue
        const wrappedX = ((x % tileCount) + tileCount) % tileCount
        const key = zoom + '/' + wrappedX + '/' + y
        visible.add(key)
        let image = tiles.get(key)
        if (!image) {
          image = document.createElement('img')
          image.className = 'rec-map__tile'
          image.alt = ''
          image.draggable = false
          image.decoding = 'async'
          image.loading = 'lazy'
          image.referrerPolicy = 'strict-origin-when-cross-origin'
          image.src = OSM_TILE_BASE + key + '.png'
          image.addEventListener('error', () => {
            if (!destroyed && tiles.get(key) === image) {
              failure.hidden = false
              fallbackDetails.open = true
            }
          })
          tiles.set(key, image)
          tileLayer.appendChild(image)
        }
        image.style.left = Math.round(x * TILE_SIZE - left) + 'px'
        image.style.top = Math.round(y * TILE_SIZE - top) + 'px'
      }
    }
    for (const [key, image] of tiles) {
      if (visible.has(key)) continue
      image.remove()
      tiles.delete(key)
    }
  }

  function renderMarkers(centerPixel: Pixel, width: number, height: number): void {
    const world = TILE_SIZE * 2 ** zoom
    const visible: Array<{ marker: MapMarker; button: HTMLButtonElement; x: number; y: number }> = []
    for (const marker of markers) {
      const button = markerButtons.get(marker.id)
      if (!button) continue
      const pixel = project(marker, zoom)
      let deltaX = pixel.x - centerPixel.x
      if (deltaX > world / 2) deltaX -= world
      if (deltaX < -world / 2) deltaX += world
      const x = width / 2 + deltaX
      const y = mapAnchorY(height) + pixel.y - centerPixel.y
      button.style.left = Math.round(x) + 'px'
      button.style.top = Math.round(y) + 'px'
      button.hidden = x < -30 || x > width + 30 || y < -30 || y > height + 30
      if (!button.hidden) visible.push({ marker, button, x, y })
    }

    clusterLayer.replaceChildren()
    const groups: Array<Array<(typeof visible)[number]>> = []
    for (const point of visible) {
      const nearby = groups.find((group) => {
        const anchor = group[0]
        return Math.hypot(point.x - anchor.x, point.y - anchor.y) < 42
      })
      if (nearby) nearby.push(point)
      else groups.push([point])
    }
    for (const group of groups) {
      if (group.length < 2) continue
      for (const point of group) point.button.hidden = true
      const x = group.reduce((sum, point) => sum + point.x, 0) / group.length
      const y = group.reduce((sum, point) => sum + point.y, 0) / group.length
      const cluster = makeButton(
        'rec-map__cluster',
        zoom >= MAX_ZOOM ? copy().clusterOpen(group.length) : copy().clusterZoom(group.length),
        String(group.length),
      )
      cluster.style.left = Math.round(x) + 'px'
      cluster.style.top = Math.round(y) + 'px'
      cluster.addEventListener('click', () => {
        if (zoom >= MAX_ZOOM) {
          selectMarker(group[0].marker.id, true)
          return
        }
        const centerLat = group.reduce((sum, point) => sum + point.marker.lat, 0) / group.length
        const centerLon = group.reduce((sum, point) => sum + point.marker.lon, 0) / group.length
        center = { lat: centerLat, lon: centerLon }
        changeZoom(1)
      })
      clusterLayer.appendChild(cluster)
    }
  }

  function renderRouteLine(centerPixel: Pixel, width: number, height: number): void {
    if (routeLine.length < 2) {
      routeSvg.style.display = 'none'
      return
    }
    routeSvg.style.display = ''
    routeSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    routeSvg.setAttribute('width', String(width))
    routeSvg.setAttribute('height', String(height))
    routeSvg.classList.toggle('is-schematic', schematic)
    const world = TILE_SIZE * 2 ** zoom
    const positions = routeLine.map((point) => {
      const pixel = project(point, zoom)
      let deltaX = pixel.x - centerPixel.x
      if (deltaX > world / 2) deltaX -= world
      if (deltaX < -world / 2) deltaX += world
      return { x: width / 2 + deltaX, y: mapAnchorY(height) + pixel.y - centerPixel.y }
    })
    const path = positions.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    routeHalo.setAttribute('d', path)
    routePath.setAttribute('d', path)
    routeStart.setAttribute('cx', positions[0].x.toFixed(1))
    routeStart.setAttribute('cy', positions[0].y.toFixed(1))
  }

  function render(): void {
    if (destroyed) return
    const { width, height } = viewportSize()
    viewport.style.setProperty('--map-bottom-inset', Math.round(effectiveBottomInset(height)) + 'px')
    const centerPixel = project(center, zoom)
    renderTiles(centerPixel, width, height)
    renderRouteLine(centerPixel, width, height)
    renderMarkers(centerPixel, width, height)
    zoomIn.disabled = zoom >= MAX_ZOOM
    zoomOut.disabled = zoom <= MIN_ZOOM
    fitButton.textContent = markers.length ? copy().fitAll : copy().fitCity
    fitButton.setAttribute('aria-label', markers.length ? copy().fitAllLabel : copy().fitCityLabel)
  }

  function syncSelection(): void {
    const marker = markers.find((item) => item.id === selectedId)
    selectedLine.textContent = marker ? copy().selected(marker.name) : copy().selectPrompt
    for (const [id, button] of markerButtons) {
      const selected = id === selectedId
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    }
    for (const [id, button] of listButtons) {
      const selected = id === selectedId
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    }
  }

  function selectMarker(id: string, notify: boolean): void {
    const marker = markers.find((item) => item.id === id)
    if (!marker) return
    selectedId = id
    syncSelection()
    const { width, height } = viewportSize()
    const markerPixel = project(marker, zoom)
    const centerPixel = project(center, zoom)
    const selectedY = mapAnchorY(height) + markerPixel.y - centerPixel.y
    if (Math.abs(markerPixel.x - centerPixel.x) > width * 0.32
      || selectedY < 40 || selectedY > visibleHeight(height) - 40) {
      center = { lat: marker.lat, lon: marker.lon }
      queueRender()
    }
    if (markerButtons.get(id)?.hidden) {
      center = { lat: marker.lat, lon: marker.lon }
      while (zoom < MAX_ZOOM) {
        const markerAtZoom = project(marker, zoom)
        const overlaps = markers.some((other) => other.id !== id
          && Math.hypot(
            project(other, zoom).x - markerAtZoom.x,
            project(other, zoom).y - markerAtZoom.y,
          ) < 42)
        if (!overlaps) break
        zoom += 1
      }
      resizedAfterInteraction = true
      queueRender()
    }
    if (notify) options.onSelect?.(id)
  }

  function rebuildMarkerControls(): void {
    markerLayer.replaceChildren()
    fallbackList.replaceChildren()
    fallbackSummary.textContent = `${copy().stops} (${markers.length})`
    fallbackDetails.hidden = markers.length === 0
    markerButtons.clear()
    listButtons.clear()
    markers.forEach((marker, index) => {
      const isTrip = marker.kind === 'trip'
      const label = isTrip ? copy().showTrip(marker.name) : copy().showStop(marker.name)
      const pin = makeButton('rec-map__marker', label, String(index + 1))
      pin.title = marker.name
      pin.classList.toggle('is-trip', isTrip)
      pin.addEventListener('click', () => selectMarker(marker.id, true))
      markerLayer.appendChild(pin)
      markerButtons.set(marker.id, pin)

      const listButton = makeButton('rec-map__list-item', label, '')
      const number = document.createElement('span')
      number.className = 'rec-map__list-number'
      number.textContent = String(index + 1)
      const name = document.createElement('span')
      name.textContent = marker.name
      listButton.appendChild(number)
      listButton.appendChild(name)
      listButton.addEventListener('click', () => selectMarker(marker.id, true))
      fallbackList.appendChild(listButton)
      listButtons.set(marker.id, listButton)
    })
    if (markers.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'rec-map__empty'
      empty.textContent = copy().noPins
      fallbackList.appendChild(empty)
    }
    syncSelection()
  }

  function changeZoom(delta: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta))
    if (next === zoom) return
    zoom = next
    resizedAfterInteraction = true
    queueRender()
  }

  function panBy(dx: number, dy: number): void {
    const centerPixel = project(center, zoom)
    const world = TILE_SIZE * 2 ** zoom
    center = unproject({
      x: centerPixel.x - dx,
      y: Math.max(0, Math.min(world, centerPixel.y - dy)),
    }, zoom)
    resizedAfterInteraction = true
    queueRender()
  }

  zoomIn.addEventListener('click', () => changeZoom(1))
  zoomOut.addEventListener('click', () => changeZoom(-1))
  fitButton.addEventListener('click', () => {
    resizedAfterInteraction = false
    fitMarkers()
  })
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('button, a')) return
    if (activePointer !== null) return
    activePointer = event.pointerId
    lastPointer = { x: event.clientX, y: event.clientY }
    viewport.setPointerCapture(event.pointerId)
    viewport.classList.add('is-dragging')
  })
  viewport.addEventListener('pointermove', (event) => {
    if (activePointer !== event.pointerId || !lastPointer) return
    panBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y)
    lastPointer = { x: event.clientX, y: event.clientY }
  })
  function stopDragging(event: PointerEvent): void {
    if (activePointer !== event.pointerId) return
    activePointer = null
    lastPointer = null
    viewport.classList.remove('is-dragging')
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  }
  viewport.addEventListener('pointerup', stopDragging)
  viewport.addEventListener('pointercancel', stopDragging)
  viewport.addEventListener('keydown', (event) => {
    const key = event.key
    if (key === '+' || key === '=') changeZoom(1)
    else if (key === '-') changeZoom(-1)
    else if (key === 'ArrowLeft') panBy(64, 0)
    else if (key === 'ArrowRight') panBy(-64, 0)
    else if (key === 'ArrowUp') panBy(0, 64)
    else if (key === 'ArrowDown') panBy(0, -64)
    else if (key === '0') {
      resizedAfterInteraction = false
      fitMarkers()
    } else return
    event.preventDefault()
  })
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 1 : -1)
  }, { passive: false })

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (destroyed) return
      if (!resizedAfterInteraction) fitMarkers()
      else queueRender()
    })
    : null
  resizeObserver?.observe(viewport)
  rebuildMarkerControls()
  fitMarkers()

  return {
    update(nextMarkers, nextCenter, nextRouteLine, nextSchematic) {
      markers = cleanMarkers(nextMarkers)
      routeLine = cleanRouteLine(nextRouteLine)
      schematic = nextSchematic ?? true
      preferredCenter = validCoordinate(nextCenter) ? nextCenter : undefined
      if (!markers.some((marker) => marker.id === selectedId)) selectedId = ''
      failure.hidden = true
      resizedAfterInteraction = false
      rebuildMarkerControls()
      fitMarkers()
    },
    select(id) {
      selectMarker(id, false)
    },
    focus(point) {
      if (!validCoordinate(point)) return
      center = { lat: point.lat, lon: point.lon }
      zoom = Math.max(zoom, 14)
      resizedAfterInteraction = true
      queueRender()
    },
    fit() {
      resizedAfterInteraction = false
      fitMarkers()
    },
    setBottomInset(px) {
      const next = Number.isFinite(px) ? Math.max(0, px) : 0
      if (Math.abs(next - bottomInset) < 1) return
      bottomInset = next
      if (resizedAfterInteraction) queueRender()
      else fitMarkers()
    },
    setLanguage(nextLanguage) {
      if (language === nextLanguage) return
      language = MAP_COPY[nextLanguage] ? nextLanguage : 'ru'
      applyLanguage()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      tiles.clear()
      markerButtons.clear()
      listButtons.clear()
      root.remove()
    },
  }
}
