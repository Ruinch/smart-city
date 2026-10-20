import './dialog-motion.css'

type DialogMotionState = {
  animation: Animation | null
  frame: number | null
  revision: number
  closing: Promise<void> | null
  resolveClosing: (() => void) | null
}

const states = new WeakMap<HTMLDialogElement, DialogMotionState>()
const ease = 'cubic-bezier(.2, 0, .2, 1)'

function stateFor(dialog: HTMLDialogElement): DialogMotionState {
  let state = states.get(dialog)
  if (state) return state

  state = {
    animation: null,
    frame: null,
    revision: 0,
    closing: null,
    resolveClosing: null,
  }
  states.set(dialog, state)

  // A form method="dialog" or other native close can bypass this helper.
  dialog.addEventListener('close', () => {
    if (dialog.open) return // An old close event may arrive after an immediate reopen.
    const current = states.get(dialog)
    if (!current) return
    current.revision += 1
    cancelWork(current)
    settleClose(current)
    dialog.removeAttribute('data-motion')
  })

  return state
}

function cancelWork(state: DialogMotionState): void {
  if (state.frame !== null) cancelAnimationFrame(state.frame)
  state.frame = null
  if (state.animation) state.animation.cancel()
  state.animation = null
}

function settleClose(state: DialogMotionState): void {
  state.resolveClosing?.()
  state.resolveClosing = null
  state.closing = null
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function currentPose(dialog: HTMLDialogElement): { opacity: string; translate: string } {
  const style = getComputedStyle(dialog)
  return {
    opacity: style.opacity || '1',
    translate: style.translate && style.translate !== 'none' ? style.translate : '0 0',
  }
}

/**
 * Opens a native modal dialog and animates its surface/backdrop. Calling this
 * while an exit is in progress cancels that exit, retaining the top layer and
 * native focus trap. The interrupted close promise resolves without closing.
 */
export function openDialog(dialog: HTMLDialogElement): void {
  const state = stateFor(dialog)
  if (dialog.open && !state.closing && dialog.dataset.motion === 'open') return

  const reversing = dialog.open
  const from = reversing ? currentPose(dialog) : { opacity: '0', translate: '0 24px' }
  state.revision += 1
  const revision = state.revision
  cancelWork(state)
  settleClose(state)

  if (!dialog.open) {
    dialog.dataset.motion = 'preopen'
    dialog.showModal()
  }

  if (reducedMotion() || typeof dialog.animate !== 'function') {
    dialog.dataset.motion = 'open'
    return
  }

  // The backdrop is a pseudo-element; CSS transitions retarget smoothly when
  // a closing dialog is reopened. Let its pre-open style paint for one frame.
  if (reversing) {
    dialog.dataset.motion = 'open'
  } else {
    state.frame = requestAnimationFrame(() => {
      state.frame = null
      if (state.revision === revision && dialog.open) dialog.dataset.motion = 'open'
    })
  }

  const animation = dialog.animate(
    [from, { opacity: '1', translate: '0 0' }],
    { duration: 280, easing: ease, fill: 'both' },
  )
  state.animation = animation
  animation.onfinish = () => {
    if (state.revision !== revision) return
    state.animation = null
    animation.cancel() // CSS supplies the final visible pose.
  }
}

/**
 * Animates out before calling dialog.close(), keeping native modal focus
 * trapping throughout the exit. Repeated calls share one promise. A reopen
 * interrupts the exit and resolves that promise without closing the dialog.
 */
export function closeAnimatedDialog(dialog: HTMLDialogElement): Promise<void> {
  const state = stateFor(dialog)
  if (!dialog.open) return Promise.resolve()
  if (state.closing) return state.closing

  const from = currentPose(dialog)
  state.revision += 1
  const revision = state.revision
  cancelWork(state)
  dialog.dataset.motion = 'closing'

  state.closing = new Promise<void>((resolve) => { state.resolveClosing = resolve })
  const closing = state.closing

  if (reducedMotion() || typeof dialog.animate !== 'function') {
    dialog.close()
    settleClose(state)
    return closing
  }

  const animation = dialog.animate(
    [from, { opacity: '0', translate: '0 12px' }],
    { duration: 180, easing: ease, fill: 'both' },
  )
  state.animation = animation
  animation.onfinish = () => {
    if (state.revision !== revision || !dialog.open) return
    state.animation = null
    dialog.close()
    animation.cancel()
    settleClose(state)
  }
  return closing
}
