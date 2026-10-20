import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountVectorBasemap, type VectorBasemapCamera, type VectorBasemapFrame } from './vector-basemap'

const mocked = vi.hoisted(() => {
  type Listener = (event?: unknown) => void

  class FakeGPUInitializationError extends Error {}

  class FakeMap {
    static instances: FakeMap[] = []
    static failConstruction = false

    options: Record<string, unknown>
    listeners = new globalThis.Map<string, Set<Listener>>()
    jumps: Record<string, unknown>[] = []
    layoutChanges: { id: string; property: string; value: unknown }[] = []
    pixelRatios: number[] = []
    renderedFeatures: unknown[] = [{ type: 'Feature' }]
    displayedCenter = { lng: 71.4491, lat: 51.1694 }
    displayedZoom = 14
    canvas = { clientWidth: 400, clientHeight: 800 }
    mapContainer = { clientWidth: 400, clientHeight: 800 }
    projections: [number, number][] = []
    repaintCount = 0
    resizeCount = 0
    removed = false

    constructor(options: Record<string, unknown>) {
      if (FakeMap.failConstruction) throw new FakeGPUInitializationError('WebGL2 unavailable')
      this.options = options
      FakeMap.instances.push(this)
    }

    on(type: string, listener: Listener): this {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)?.add(listener)
      return this
    }

    off(type: string, listener: Listener): this {
      this.listeners.get(type)?.delete(listener)
      return this
    }

    emit(type: string, event?: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }

    jumpTo(camera: Record<string, unknown>): this {
      this.jumps.push(camera)
      return this
    }

    resize(): this {
      this.resizeCount += 1
      return this
    }

    setPixelRatio(ratio: number): void {
      this.pixelRatios.push(ratio)
    }

    triggerRepaint(): void {
      this.repaintCount += 1
    }

    getCanvas(): typeof this.canvas {
      return this.canvas
    }

    getContainer(): typeof this.mapContainer {
      return this.mapContainer
    }

    getCenter(): typeof this.displayedCenter {
      return this.displayedCenter
    }

    getZoom(): number {
      return this.displayedZoom
    }

    project(point: [number, number]): { x: number; y: number } {
      this.projections.push(point)
      return {
        x: (point[0] - this.displayedCenter.lng) * 10 + this.canvas.clientWidth / 2,
        y: (this.displayedCenter.lat - point[1]) * 10 + this.canvas.clientHeight / 2,
      }
    }

    getStyle(): { layers: Record<string, unknown>[] } {
      return {
        layers: [
          { id: 'city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
          { id: 'road-shield', type: 'symbol', layout: { 'text-field': ['get', 'ref'] } },
        ],
      }
    }

    queryRenderedFeatures(): unknown[] {
      return this.renderedFeatures
    }

    setLayoutProperty(id: string, property: string, value: unknown): this {
      this.layoutChanges.push({ id, property, value })
      return this
    }

    remove(): void {
      this.removed = true
    }
  }

  const workerUrls: string[] = []
  return { FakeMap, FakeGPUInitializationError, workerUrls }
})

vi.mock('maplibre-gl', () => ({
  Map: mocked.FakeMap,
  GPUInitializationError: mocked.FakeGPUInitializationError,
  setWorkerUrl: (url: string) => mocked.workerUrls.push(url),
}))

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/fake-map-worker.mjs',
}))

const initialCamera: VectorBasemapCamera = {
  center: { lat: 51.1694, lon: 71.4491 },
  zoom: 15,
  width: 400,
  height: 800,
  bottomInset: 200,
  language: 'ru',
}

const container = {} as HTMLElement

beforeEach(() => {
  mocked.FakeMap.instances.length = 0
  mocked.FakeMap.failConstruction = false
  mocked.workerUrls.length = 0
  vi.stubGlobal('window', { devicePixelRatio: 3 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('vector basemap adapter', () => {
  it('aligns the vector camera and retains native high-DPI rendering', async () => {
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]

    expect(mocked.workerUrls).toEqual(['/assets/fake-map-worker.mjs'])
    expect(map.options).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/liberty',
      interactive: false,
      attributionControl: false,
      pixelRatio: 3,
      maxZoom: 17,
    })
    expect(map.jumps[0]).toMatchObject({
      center: [71.4491, 51.1694],
      zoom: 14,
      padding: { top: 0, right: 0, bottom: 200, left: 0 },
    })
    expect(map.resizeCount).toBe(1)

    map.emit('style.load')
    expect(map.layoutChanges).toHaveLength(1)
    expect(map.layoutChanges[0].id).toBe('city')
    expect(JSON.stringify(map.layoutChanges[0].value)).toContain('name:ru')
    map.emit('load')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()

    controller.update({ ...initialCamera, language: 'kk' })
    expect(map.layoutChanges).toHaveLength(2)
    expect(JSON.stringify(map.layoutChanges[1].value)).toContain('name:kk')
    expect(map.jumps).toHaveLength(1)

    window.devicePixelRatio = 2
    controller.update({ ...initialCamera, width: 420, language: 'kk' })
    expect(map.pixelRatios).toEqual([2])
    expect(map.resizeCount).toBe(2)
    expect(onFailure).not.toHaveBeenCalled()
    controller.destroy()
    expect(map.removed).toBe(true)
  })

  it('reports constructor failure after returning a controller', async () => {
    mocked.FakeMap.failConstruction = true
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onFailure,
    })
    expect(onFailure).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0][0].message).toBe('WebGL2 unavailable')
    controller.destroy()
  })

  it('lets transient source errors recover and cancels the load timer on destroy', async () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]
    map.emit('error', { error: new Error('Temporary tile error') })
    await Promise.resolve()
    expect(onFailure).not.toHaveBeenCalled()
    map.emit('load')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()
    controller.destroy()
    await vi.advanceTimersByTimeAsync(12_001)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('keeps raster visible until vector geometry actually renders', async () => {
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]
    map.renderedFeatures = []
    map.emit('load')
    await Promise.resolve()
    expect(onReady).not.toHaveBeenCalled()

    map.renderedFeatures = [{ type: 'Feature' }]
    map.emit('render')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()
    expect(map.listeners.get('render')?.size).toBe(1)
    expect(onFailure).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('falls back when WebGL context is lost after loading', async () => {
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onFailure,
    })
    const map = mocked.FakeMap.instances[0]
    map.emit('load')
    map.emit('webglcontextlost')
    await Promise.resolve()
    expect(onFailure).toHaveBeenCalledOnce()
    controller.destroy()
  })

  it('delivers readiness before the guaranteed first rendered frame', async () => {
    const order: string[] = []
    const onRender = vi.fn(() => order.push('render'))
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: () => order.push('ready'), onRender, onFailure: vi.fn(),
    })
    const map = mocked.FakeMap.instances[0]
    map.emit('render')
    expect(order).toEqual([])
    map.emit('load')
    map.emit('render')
    expect(order).toEqual([])

    await Promise.resolve()
    expect(order).toEqual(['ready'])
    expect(map.repaintCount).toBe(2)
    expect(onRender).not.toHaveBeenCalled()
    map.emit('render')
    expect(order).toEqual(['ready', 'render'])

    controller.update(initialCamera)
    expect(map.repaintCount).toBe(3)
    expect(onRender).toHaveBeenCalledOnce()
    map.emit('render')
    expect(onRender).toHaveBeenCalledTimes(2)
    controller.destroy()
  })

  it('projects overlays only on a drawn frame using the actual map camera and dimensions', async () => {
    const projections: { x: number; y: number }[] = []
    const onRender = vi.fn((frame: VectorBasemapFrame) => {
      projections.push(frame.project({ lat: 51, lon: -179 }))
    })
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onRender, onFailure: vi.fn(),
    })
    const map = mocked.FakeMap.instances[0]
    map.emit('load')
    await Promise.resolve()

    controller.update({
      ...initialCamera, center: { lat: 52, lon: 178 }, zoom: 17, width: 500, height: 700,
    })
    expect(onRender).not.toHaveBeenCalled()
    // jumpTo has requested a different camera; this draw still reports what the
    // renderer actually displays, rather than the adapter's requested values.
    map.displayedCenter = { lng: 179, lat: 51.5 }
    map.displayedZoom = 15.25
    map.canvas = { clientWidth: 420, clientHeight: 760 }
    map.emit('render')

    expect(onRender).toHaveBeenCalledOnce()
    expect(onRender.mock.calls[0][0]).toMatchObject({ width: 420, height: 760, zoom: 16.25 })
    expect(map.projections).toEqual([[181, 51]])
    expect(projections).toEqual([{ x: 230, y: 385 }])
    controller.destroy()
  })

  it('uses container dimensions when canvas layout is unavailable and stops rendering after cleanup', async () => {
    const onRender = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onRender, onFailure: vi.fn(),
    })
    const map = mocked.FakeMap.instances[0]
    map.canvas = { clientWidth: 0, clientHeight: 0 }
    map.mapContainer = { clientWidth: 430, clientHeight: 780 }
    map.emit('load')
    await Promise.resolve()
    map.emit('render')
    expect(onRender.mock.calls[0][0]).toMatchObject({ width: 430, height: 780 })

    controller.destroy()
    expect(map.listeners.get('render')?.size).toBe(0)
    map.emit('render')
    controller.update(initialCamera)
    expect(onRender).toHaveBeenCalledOnce()
  })

  it('never delivers a rendered frame after losing the graphics context', async () => {
    const onRender = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onRender, onFailure,
    })
    const map = mocked.FakeMap.instances[0]
    map.emit('load')
    await Promise.resolve()
    map.emit('render')
    expect(onRender).toHaveBeenCalledOnce()

    map.emit('webglcontextlost')
    map.emit('render')
    await Promise.resolve()
    expect(onRender).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledOnce()
    controller.destroy()
  })
})
