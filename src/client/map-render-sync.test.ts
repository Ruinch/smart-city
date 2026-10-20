import { afterEach, expect, test, vi } from 'vitest'
import { mountRecommendationsMap, type MapCoordinate } from './map'
import type { VectorBasemapCamera, VectorBasemapCallbacks, VectorBasemapFrame } from './vector-basemap'

interface FakeVector {
  camera: VectorBasemapCamera
  callbacks: VectorBasemapCallbacks
  updates: VectorBasemapCamera[]
  destroyed: boolean
  update(camera: VectorBasemapCamera): void
  destroy(): void
  emitReady(): void
  emitFrame(frame: VectorBasemapFrame): void
}

const vectorMock = vi.hoisted(() => ({ instances: [] as FakeVector[] }))

vi.mock('./vector-basemap', () => ({
  mountVectorBasemap(_container: HTMLElement, camera: VectorBasemapCamera, callbacks: VectorBasemapCallbacks): FakeVector {
    const vector: FakeVector = {
      camera,
      callbacks,
      updates: [],
      destroyed: false,
      update(next) { this.camera = next; this.updates.push(next) },
      destroy() { this.destroyed = true },
      emitReady() { this.callbacks.onReady() },
      emitFrame(frame) { this.callbacks.onRender?.(frame) },
    }
    vectorMock.instances.push(vector)
    return vector
  },
}))

class FakeStyle {
  left = ''
  top = ''
  display = ''
  transform = ''
  properties = new Map<string, string>()
  setProperty(name: string, value: string): void { this.properties.set(name, value) }
}

class FakeElement extends EventTarget {
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  classes = new Set<string>()
  captured = new Set<number>()
  dataset: Record<string, string> = {}
  style = new FakeStyle()
  clientWidth = 400
  clientHeight = 800
  hidden = false
  inert = false
  textContent = ''
  title = ''
  type = ''
  href = ''
  target = ''
  rel = ''
  src = ''
  draggable = false
  decoding = ''
  loading = ''
  referrerPolicy = ''
  complete = false
  naturalWidth = 0

  constructor(readonly tagName: string) { super() }

  get className(): string { return [...this.classes].join(' ') }
  set className(value: string) { this.classes = new Set(value.split(/\s+/).filter(Boolean)) }

  classList = {
    add: (...names: string[]) => { names.forEach((name) => this.classes.add(name)) },
    remove: (...names: string[]) => { names.forEach((name) => this.classes.delete(name)) },
    toggle: (name: string, force?: boolean) => {
      const next = force ?? !this.classes.has(name)
      if (next) this.classes.add(name)
      else this.classes.delete(name)
      return next
    },
    contains: (name: string) => this.classes.has(name),
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.remove()
    child.parentElement = this
    this.children.push(child)
    return child
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null
    this.children = []
    children.forEach((child) => this.appendChild(child))
  }

  remove(): void {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  closest(selector: string): FakeElement | null {
    if (selector === 'button, a' && (this.tagName === 'button' || this.tagName === 'a')) return this
    return this.parentElement?.closest(selector) ?? null
  }
  getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth,
      height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight,
      toJSON: () => ({}) } as DOMRect
  }
  setPointerCapture(id: number): void { this.captured.add(id) }
  hasPointerCapture(id: number): boolean { return this.captured.has(id) }
  releasePointerCapture(id: number): void { this.captured.delete(id) }
  focus(): void {}

  find(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this
    for (const child of this.children) {
      const found = child.find(className)
      if (found) return found
    }
    return undefined
  }
}

function frame(shiftX: number, shiftY: number, zoom = 13): VectorBasemapFrame {
  return {
    width: 400,
    height: 800,
    zoom,
    project(point: MapCoordinate) {
      return {
        x: 120 + shiftX + (point.lon - 71.4491) * 1000,
        y: 180 + shiftY - (point.lat - 51.1694) * 1000,
      }
    },
  }
}

function pointer(viewport: FakeElement, type: string, pointerId: number, clientX: number, clientY: number): void {
  viewport.dispatchEvent(Object.assign(new Event(type), {
    pointerId, pointerType: 'touch', button: 0, clientX, clientY,
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vectorMock.instances.length = 0
})

test('drag and pinch overlays follow the drawn vector frame, not the earlier app frame', async () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const host = new FakeElement('div')
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('document', {
    hidden: false,
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
  })
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: true }),
    setTimeout,
    clearTimeout,
  })
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  function advanceAppFrame(): void {
    const scheduled = [...frames.values()]
    frames.clear()
    scheduled.forEach((callback) => callback(16))
  }

  const marker = { id: 'cafe', name: 'Кафе', lat: 51.1694, lon: 71.4491 }
  const start = { lat: 51.1694, lon: 71.4791 }
  const target = { lat: 51.1394, lon: 71.4491 }
  const map = mountRecommendationsMap(host as unknown as HTMLElement, {
    markers: [marker],
    center: marker,
    startPoint: start,
    routeLine: [marker, target],
  })
  map.setTargetArea(target)
  advanceAppFrame() // Request the vector module; raster still draws while it loads.
  await vi.waitFor(() => expect(vectorMock.instances).toHaveLength(1))
  const vector = vectorMock.instances[0]
  advanceAppFrame()
  vector.emitReady()
  advanceAppFrame()
  vector.emitFrame(frame(0, 0))

  const viewport = host.find('rec-map__viewport')!
  const pin = host.find('rec-map__marker')!
  const startPin = host.find('rec-map__start-point')!
  const targetPin = host.find('rec-map__target-area')!
  const routePath = host.find('rec-map__route-path')!
  const initial = {
    pin: [pin.style.left, pin.style.top],
    start: [startPin.style.left, startPin.style.top],
    target: [targetPin.style.left, targetPin.style.top],
    route: routePath.getAttribute('d'),
  }
  expect(initial).toEqual({
    pin: ['120.0px', '180.0px'],
    start: ['150.0px', '180.0px'],
    target: ['120.0px', '210.0px'],
    route: 'M 120.0 180.0 L 120.0 210.0',
  })

  const beforeDrag = vector.updates.length
  const beforeDragCenter = vector.camera.center
  pointer(viewport, 'pointerdown', 1, 100, 100)
  pointer(viewport, 'pointermove', 1, 155, 125)
  advanceAppFrame() // jumpTo was requested, but the vector canvas has not rendered it.
  expect(vector.updates.length).toBeGreaterThan(beforeDrag)
  expect(vector.camera.center).not.toEqual(beforeDragCenter)
  expect([pin.style.left, pin.style.top, startPin.style.left, targetPin.style.top, routePath.getAttribute('d')])
    .toEqual(['120.0px', '180.0px', '150.0px', '210.0px', initial.route])

  vector.emitFrame(frame(55, 25))
  expect([pin.style.left, pin.style.top, startPin.style.left, targetPin.style.top, routePath.getAttribute('d')])
    .toEqual(['175.0px', '205.0px', '205.0px', '235.0px', 'M 175.0 205.0 L 175.0 235.0'])

  const beforePinch = vector.updates.length
  const beforePinchZoom = vector.camera.zoom
  pointer(viewport, 'pointerdown', 2, 210, 100)
  pointer(viewport, 'pointermove', 2, 260, 110)
  advanceAppFrame() // Pinch also waits for the corresponding canvas render.
  expect(vector.updates.length).toBeGreaterThan(beforePinch)
  expect(vector.camera.zoom).toBeGreaterThan(beforePinchZoom)
  expect([pin.style.left, startPin.style.left, targetPin.style.top, routePath.getAttribute('d')])
    .toEqual(['175.0px', '205.0px', '235.0px', 'M 175.0 205.0 L 175.0 235.0'])
  vector.emitFrame(frame(70, 35, 14))
  expect([pin.style.left, startPin.style.left, targetPin.style.top, routePath.getAttribute('d')])
    .toEqual(['190.0px', '220.0px', '245.0px', 'M 190.0 215.0 L 190.0 245.0'])

  pointer(viewport, 'pointerup', 2, 260, 110)
  pointer(viewport, 'pointerup', 1, 155, 125)
  const updateCount = vector.updates.length
  map.setStartPoint({ lat: 51.1694, lon: 71.4891 })
  advanceAppFrame()
  expect(vector.updates.length).toBeGreaterThan(updateCount)
  expect(startPin.style.left).toBe('220.0px')
  vector.emitFrame(frame(70, 35, 14))
  expect(startPin.style.left).toBe('230.0px')

  map.destroy()
  expect(vector.destroyed).toBe(true)
})
