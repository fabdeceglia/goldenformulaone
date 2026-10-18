import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface RowMenuItem {
  label: string
  onSelect: () => void
}

interface RowMenuProps {
  /** Accessible name for both the trigger and the menu, e.g. "Monza actions". */
  label: string
  items: RowMenuItem[]
}

/** Gap between the trigger and the menu, and between the menu and a viewport edge. */
const GAP = 6
const EDGE = 8

const ROAMING_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/**
 * A row's actions behind a "kebab". A phone cannot spare the width of an inline
 * Info and Results button on every schedule row, so both fold in here instead.
 *
 * The menu is portalled to the body and pinned to the viewport, because the
 * schedule table scrolls inside an `overflow: hidden` panel that would clip
 * anything anchored to the row.
 */
export function RowMenu({ label, items }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Measure the menu and pin it under the trigger, nudged back inside the
  // viewport when the row sits near an edge. A layout effect, so the menu is
  // never painted at its unpositioned corner.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const anchor = trigger.getBoundingClientRect()
    const size = menu.getBoundingClientRect()

    let top = anchor.bottom + GAP
    if (top + size.height > window.innerHeight - EDGE) top = anchor.top - GAP - size.height

    const left = Math.max(
      EDGE,
      Math.min(anchor.right - size.width, window.innerWidth - size.width - EDGE),
    )

    setPosition({ top: Math.max(EDGE, top), left })
  }, [open])

  // A menu button opens with focus on its first item. `preventScroll` keeps that
  // from reading as a scroll and dismissing the menu the moment it appears.
  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true })
  }, [open])

  // Dismiss on the moves a menu pinned to a scrolling row cannot follow.
  useEffect(() => {
    if (!open) return

    const close = () => setOpen(false)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      triggerRef.current?.focus()
      close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Arrow keys roam the items; Tab gives up the menu and hands focus back to the
  // trigger, which is the only thing before it on screen.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      triggerRef.current?.focus()
      setOpen(false)
      return
    }
    if (!ROAMING_KEYS.includes(event.key)) return
    event.preventDefault()

    const entries = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ]
    if (entries.length === 0) return

    const current = entries.indexOf(document.activeElement as HTMLButtonElement)
    const last = entries.length - 1
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowDown'
            ? (current + 1) % entries.length
            : (current - 1 + entries.length) % entries.length

    entries[next].focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => {
          // Drop the last position so the menu is measured afresh each time.
          setPosition(null)
          setOpen((current) => !current)
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className="row-menu"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Hidden until measured — but with opacity, not `visibility`: the
              // first item is focused as the menu opens, and a `visibility: hidden`
              // element refuses focus, which can happen before the measurement
              // re-render lands.
              opacity: position ? 1 : 0,
              pointerEvents: position ? 'auto' : 'none',
            }}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="row-menu__item"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
