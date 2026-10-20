import './disclosure-motion.css'

type DisclosureState = {
  animation: Animation | null
  revision: number
  closing: boolean
}

const mounted = new WeakMap<HTMLDetailsElement, DisclosureState>()
const ease = 'cubic-bezier(.2, 0, .2, 1)'

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function currentPose(body: HTMLElement): { height: string; opacity: string } {
  const style = getComputedStyle(body)
  return {
    height: `${Math.max(0, body.getBoundingClientRect().height)}px`,
    opacity: style.opacity || '1',
  }
}

/**
 * Enhances a native <details> with an interruptible reveal. Markup must have a
 * direct <summary> followed by a direct .place-details-body wrapper. Summary
 * clicks (including keyboard activation) are handled here so the native open
 * attribute can remain true until an exit animation finishes. Calling twice
 * is safe. If motion is reduced or WAAPI is absent, details toggles instantly.
 */
export function mountDisclosure(details: HTMLDetailsElement): void {
  if (mounted.has(details)) return
  const summary = Array.from(details.children).find((child): child is HTMLElement => child.tagName === 'SUMMARY')
  const body = Array.from(details.children).find((child): child is HTMLElement => child.classList.contains('place-details-body'))
  if (!summary || !body) return

  const state: DisclosureState = { animation: null, revision: 0, closing: false }
  mounted.set(details, state)

  summary.addEventListener('click', (event) => {
    event.preventDefault()

    const opening = !details.open || state.closing
    const from = details.open ? currentPose(body) : { height: '0px', opacity: '0' }
    state.revision += 1
    const revision = state.revision
    state.animation?.cancel()
    state.animation = null
    state.closing = !opening

    if (opening) details.open = true
    details.dataset.disclosureMotion = opening ? 'opening' : 'closing'

    if (reducedMotion() || typeof body.animate !== 'function') {
      details.open = opening
      delete details.dataset.disclosureMotion
      state.closing = false
      return
    }

    const to = opening
      ? { height: `${body.scrollHeight}px`, opacity: '1' }
      : { height: '0px', opacity: '0' }
    const animation = body.animate([from, to], {
      duration: opening ? 220 : 160,
      easing: ease,
      fill: 'both',
    })
    state.animation = animation
    animation.onfinish = () => {
      if (state.revision !== revision) return
      state.animation = null
      if (!opening) details.open = false
      animation.cancel() // Return height to its intrinsic value.
      state.closing = false
      delete details.dataset.disclosureMotion
    }
  })
}
