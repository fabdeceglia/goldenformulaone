import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  /** Accessible name for the dialog. */
  label: string
  onClose: () => void
  children: ReactNode
}

/**
 * A cream panel in a native `<dialog>`: the browser gives us the focus trap,
 * Esc handling and top-layer backdrop for free, so this stays a thin shell.
 * The caller mounts it only while something is selected, hence the open-on-mount.
 */
export function Modal({ label, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    // `showModal` lands focus on the close button; move it to the dialog so the
    // panel opens without a focus ring, while Tab still reaches the button.
    dialog.focus()
    // Closing on unmount drops the top-layer entry; the `close` event has no
    // listener, so this does not loop back into `onClose`.
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal"
      tabIndex={-1}
      aria-label={label}
      // Esc fires `cancel`; take it over so the parent owns the open state.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // A click on the backdrop targets the dialog itself, not its content.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="modal__scroll">{children}</div>
    </dialog>
  )
}
