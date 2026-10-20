export type DrawerPosition = 'collapsed' | 'half' | 'expanded'
export type DrawerHeights = Record<DrawerPosition, number>
const positions: DrawerPosition[] = ['collapsed', 'half', 'expanded']

export function drawerHeights(height: number, safeTop = 0, safeBottom = 0): DrawerHeights {
  const collapsed = Math.min(height, 64 + safeBottom)
  const expanded = Math.max(collapsed, height - Math.max(100, safeTop + 72))
  return { collapsed, half: Math.min(expanded, Math.max(collapsed, height * .60)), expanded }
}

/** Velocity is visible-height px/ms: positive means opening the panel. */
export function drawerSnap(heights: DrawerHeights, visible: number, velocity: number): DrawerPosition {
  if (velocity > .45) return positions.find((name) => heights[name] > visible + 8) ?? 'expanded'
  if (velocity < -.45) return [...positions].reverse().find((name) => heights[name] < visible - 8) ?? 'collapsed'
  return positions.reduce((best, name) => Math.abs(heights[name] - visible) < Math.abs(heights[best] - visible) ? name : best)
}

interface DrawerOptions {
  shell: HTMLElement
  handle: HTMLButtonElement
  scroll: HTMLElement
  onPosition(position: DrawerPosition): void
  onSettled(): void
}

export interface RouteDrawerController {
  readonly active: boolean
  readonly position: DrawerPosition
  setEnabled(enabled: boolean, position?: DrawerPosition): void
  move(position: DrawerPosition): void
  refresh(): void
}

/** Only the handle owns pointer capture. Map pinch and list scrolling stay native. */
export function mountRouteDrawer(options: DrawerOptions): RouteDrawerController {
  const { shell, handle, scroll } = options
  const mobile = window.matchMedia('(max-width: 760px)')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let enabled = false
  let active = false
  let position: DrawerPosition = 'half'
  let heights = drawerHeights(shell.clientHeight)
  let visible = 0
  let frame = 0
  let ignoreClickUntil = 0
  let lastGeometry = ''
  let drag: { id: number; y: number; height: number; lastY: number; time: number; velocity: number; moved: boolean; position: DrawerPosition } | null = null

  function measure(): void {
    const styles = getComputedStyle(shell)
    heights = drawerHeights(shell.clientHeight,
      parseFloat(styles.getPropertyValue('--app-safe-top')) || 0,
      parseFloat(styles.getPropertyValue('--app-safe-bottom')) || 0)
    shell.style.setProperty('--drawer-height', `${heights.expanded}px`)
  }

  function paint(height: number): void {
    visible = height
    shell.style.setProperty('--drawer-visible', `${height}px`)
    shell.style.setProperty('--drawer-offset', `${heights.expanded - height}px`)
  }

  function cancelMotion(): void {
    cancelAnimationFrame(frame)
    frame = 0
    shell.classList.remove('is-drawer-moving')
  }

  function settle(): void {
    shell.classList.remove('is-drawer-moving', 'is-drawer-dragging')
    shell.dataset.drawer = position
    scroll.inert = position === 'collapsed'
    scroll.setAttribute('aria-hidden', String(position === 'collapsed'))
    options.onPosition(position)
    options.onSettled()
  }

  function move(next: DrawerPosition, animate = true): void {
    position = next
    if (!active) return
    cancelMotion()
    shell.dataset.drawer = next
    // Keep content painted until the panel settles; prevent focus below the fold.
    scroll.inert = next === 'collapsed'
    scroll.setAttribute('aria-hidden', String(next === 'collapsed'))
    if (next === 'collapsed' && scroll.contains(document.activeElement)) handle.focus({ preventScroll: true })
    const from = visible
    const to = heights[next]
    if (!animate || reduced.matches || Math.abs(to - from) < 1) {
      paint(to)
      settle()
      return
    }
    shell.classList.add('is-drawer-moving')
    const started = performance.now()
    const duration = Math.min(360, Math.max(220, Math.abs(to - from) * .45))
    function tick(now: number): void {
      const progress = Math.min(1, (now - started) / duration)
      paint(from + (to - from) * (1 - (1 - progress) ** 4))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else { frame = 0; settle() }
    }
    frame = requestAnimationFrame(tick)
  }

  function cancelDrag(): void {
    if (!drag) return
    const id = drag.id
    drag = null
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
    shell.classList.remove('is-drawer-dragging')
  }

  function refresh(): void {
    const wasActive = active
    active = enabled && mobile.matches
    const styles = getComputedStyle(shell)
    const geometry = `${shell.clientHeight}|${styles.getPropertyValue('--app-safe-top')}|${styles.getPropertyValue('--app-safe-bottom')}`
    if (wasActive === active && geometry === lastGeometry) return
    lastGeometry = geometry
    cancelDrag()
    cancelMotion()
    if (!active) {
      delete shell.dataset.drawer
      for (const name of ['--drawer-height', '--drawer-visible', '--drawer-offset']) shell.style.removeProperty(name)
      // A breakpoint can interrupt a snap before its final callback. Commit the
      // intended position so the desktop screen and focus state agree.
      if (wasActive && enabled) {
        scroll.inert = position === 'collapsed'
        scroll.setAttribute('aria-hidden', String(position === 'collapsed'))
        options.onPosition(position)
      }
      return
    }
    measure()
    shell.dataset.drawer = position
    if (!wasActive) paint(0)
    move(position, !wasActive)
  }

  handle.addEventListener('pointerdown', (event) => {
    if (!active || !event.isPrimary || event.button !== 0) return
    ignoreClickUntil = 0 // Only suppress the click generated by the previous drag.
    cancelMotion()
    drag = {
      id: event.pointerId, y: event.clientY, height: visible,
      lastY: event.clientY, time: performance.now(), velocity: 0, moved: false, position,
    }
    handle.setPointerCapture(event.pointerId)
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const delta = drag.y - event.clientY
    if (!drag.moved && Math.abs(delta) < 5) return
    drag.moved = true
    const now = performance.now()
    drag.velocity = (drag.lastY - event.clientY) / Math.max(8, now - drag.time)
    drag.lastY = event.clientY
    drag.time = now
    shell.classList.add('is-drawer-dragging')
    scroll.inert = false
    scroll.setAttribute('aria-hidden', 'false')
    const next = Math.min(heights.expanded, Math.max(heights.collapsed, drag.height + delta))
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { frame = 0; paint(next) })
  })
  function release(event: PointerEvent): void {
    if (!drag || drag.id !== event.pointerId) return
    const current = drag
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture'
    const velocity = performance.now() - current.time > 100 ? 0 : current.velocity
    if (current.moved) {
      // Use the last actual pointer coordinate even if its paint frame is pending.
      cancelAnimationFrame(frame)
      paint(Math.min(heights.expanded, Math.max(heights.collapsed, current.height + current.y - current.lastY)))
      ignoreClickUntil = performance.now() + 400
    }
    cancelDrag()
    move(cancelled || !current.moved ? current.position : drawerSnap(heights, visible, velocity))
  }
  handle.addEventListener('pointerup', release)
  handle.addEventListener('pointercancel', release)
  handle.addEventListener('lostpointercapture', release)
  handle.addEventListener('click', (event) => {
    if (!active) return
    event.stopImmediatePropagation()
    if (performance.now() < ignoreClickUntil) return
    move(position === 'collapsed' ? 'half' : position === 'half' ? 'expanded' : 'collapsed')
  }, { capture: true })
  handle.addEventListener('keydown', (event) => {
    if (!active) return
    const index = positions.indexOf(position)
    const next = event.key === 'ArrowUp' ? positions[Math.min(2, index + 1)]
      : event.key === 'ArrowDown' ? positions[Math.max(0, index - 1)]
        : event.key === 'Home' ? 'collapsed' : event.key === 'End' ? 'expanded' : null
    if (next) { event.preventDefault(); move(next) }
  })
  reduced.addEventListener('change', () => { if (active && reduced.matches) move(position, false) })

  return {
    get active() { return active },
    get position() { return position },
    setEnabled(next, nextPosition) {
      const changed = enabled !== next || active !== (next && mobile.matches)
      enabled = next
      if (nextPosition) position = nextPosition
      if (changed) refresh()
      else if (active && nextPosition) move(nextPosition)
    },
    move,
    refresh,
  }
}
