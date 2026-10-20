import { afterEach, expect, test, vi } from 'vitest'
import { drawerHeights, mountRouteDrawer, type DrawerPosition } from './route-drawer'

class FakeElement extends EventTarget {
  clientHeight = 844
  dataset: DOMStringMap = {}
  inert = false
  attributes = new Map<string, string>()
  properties = new Map<string, string>()
  classes = new Set<string>()
  style = {
    setProperty: (name: string, value: string) => { this.properties.set(name, value) },
    removeProperty: (name: string) => { this.properties.delete(name) },
  }
  classList = {
    add: (...names: string[]) => { names.forEach((name) => this.classes.add(name)) },
    remove: (...names: string[]) => { names.forEach((name) => this.classes.delete(name)) },
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  contains(): boolean { return false }
}

class FakeHandle extends FakeElement {
  captured = new Set<number>()

  setPointerCapture(id: number): void { this.captured.add(id) }
  hasPointerCapture(id: number): boolean { return this.captured.has(id) }
  releasePointerCapture(id: number): void {
    this.captured.delete(id)
    this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }))
  }
  focus(): void {}

  pointer(type: string, clientY: number): void {
    this.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, isPrimary: true, button: 0, clientY,
    }))
  }

  click(): void { this.dispatchEvent(new Event('click', { cancelable: true })) }
}

function fixture() {
  let now = 0
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  const mobile = { matches: true, addEventListener() {} }
  const reduced = { matches: false, addEventListener() {} }
  const shell = new FakeElement()
  const scroll = new FakeElement()
  const handle = new FakeHandle()
  const positions: DrawerPosition[] = []
  shell.dataset.sheet = 'results'

  vi.stubGlobal('window', { matchMedia: (query: string) => query.includes('max-width') ? mobile : reduced })
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => shell.properties.get(name) ?? '0',
  }))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame) })

  const drawer = mountRouteDrawer({
    shell: shell as unknown as HTMLElement,
    handle: handle as unknown as HTMLButtonElement,
    scroll: scroll as unknown as HTMLElement,
    onPosition(position) {
      positions.push(position)
      // This is the state callback used by main.ts to choose the desktop surface.
      shell.dataset.sheet = position === 'collapsed' ? 'map-only' : 'results'
    },
    onSettled() {},
  })
  function advance(milliseconds: number): void {
    now += milliseconds
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(now))
  }
  function visibleHeight(): number {
    return parseFloat(shell.properties.get('--drawer-visible') ?? '0')
  }

  drawer.setEnabled(true, 'half')
  advance(1000)
  positions.length = 0
  return { drawer, shell, scroll, handle, mobile, frames, positions, advance, visibleHeight }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('a new tap during a swipe snap resumes motion and opens the panel', () => {
  const view = fixture()
  view.handle.pointer('pointerdown', 500)
  view.advance(16)
  view.handle.pointer('pointermove', 600)
  view.handle.pointer('pointerup', 600)
  view.advance(32)
  expect(view.drawer.position).toBe('collapsed')
  expect(view.visibleHeight()).toBeGreaterThan(drawerHeights(844).collapsed)

  // This tap arrives inside the previous drag's synthetic-click suppression window.
  view.handle.pointer('pointerdown', 500)
  view.handle.pointer('pointerup', 500)
  expect(view.frames.size).toBeGreaterThan(0)
  view.handle.click()
  view.advance(1000)

  expect(view.drawer.position).toBe('half')
  expect(view.visibleHeight()).toBe(drawerHeights(844).half)
  expect(view.frames.size).toBe(0)
  expect(view.shell.dataset.sheet).toBe('results')
  expect(view.scroll.inert).toBe(false)
  expect(view.scroll.attributes.get('aria-hidden')).toBe('false')
  expect(view.handle.captured.size).toBe(0)
})

test('switching to desktop during collapse commits the target before cancelling motion', () => {
  const view = fixture()
  view.drawer.move('collapsed')
  view.advance(32)
  expect(view.shell.dataset.sheet).toBe('results')
  expect(view.scroll.inert).toBe(true)

  view.mobile.matches = false
  view.drawer.refresh()

  expect(view.drawer.active).toBe(false)
  expect(view.frames.size).toBe(0)
  expect(view.positions).toEqual(['collapsed'])
  expect(view.shell.dataset.sheet).toBe('map-only')
  expect(view.shell.dataset.drawer).toBeUndefined()
  expect(view.shell.properties.has('--drawer-offset')).toBe(false)
  expect(view.scroll.attributes.get('aria-hidden')).toBe('true')
})

test('explicitly leaving the route during a snap does not overwrite the request screen', () => {
  const view = fixture()
  view.drawer.move('collapsed')
  view.advance(32)
  // main.ts restores the request before disabling its route drawer.
  view.shell.dataset.sheet = 'peek'
  view.scroll.inert = false
  view.scroll.setAttribute('aria-hidden', 'false')
  view.drawer.setEnabled(false)
  view.advance(1000)

  expect(view.positions).toEqual([])
  expect(view.shell.dataset.sheet).toBe('peek')
  expect(view.scroll.inert).toBe(false)
  expect(view.scroll.attributes.get('aria-hidden')).toBe('false')
  expect(view.frames.size).toBe(0)
})
