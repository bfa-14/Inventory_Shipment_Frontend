import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button, Group, Modal, Stack, Text, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'

interface FormModalProps {
  opened: boolean
  title: string
  children: ReactNode
  /** Submits the form; the modal shows the button in its loading state while it runs. */
  onSubmit(): void
  onClose(): void
  saving?: boolean
  saveLabel?: string
  cancelLabel?: string
  size?: string
  /**
   * Drops the Save button, leaving the footer with one button that closes the dialog. It is how a
   * read-only view reuses the very form it would edit - same fields, same order, same layout - so a
   * reader who may only look sees the record laid out exactly where an editor would find it,
   * instead of a second component free to drift from the first.
   */
  readOnly?: boolean
  /**
   * Greys out Save while the form holds something the server is certain to reject - a code a
   * pre-flight check has already found taken, say. Enter still does nothing, because the button it
   * would press is disabled.
   */
  saveDisabled?: boolean
  /*
   * (90) THREE MORE OPTIONS, ALL OFF BY DEFAULT, for the large dialogs that post (a transfer's Dispatch, Receive and
   * Dispatch and receive) and the dialogs opened on top of them. Left out, the dialog is exactly what it always was.
   */
  /**
   * False keeps Escape from closing the dialog (it never does while saving). Mantine closes EVERY open modal on one
   * Escape, so an outer dialog passes false while an inner one is open: Escape then closes the inner one only.
   */
  closeOnEscape?: boolean
  /** The whole screen (a phone): the large dialogs pass it below 48em. Not centred then. */
  fullScreen?: boolean
  /**
   * Why Save is disabled, while `saveDisabled` is true: the button's tooltip on a wide screen and, below 48em (a phone
   * shows no tooltip), a dimmed line above the footer - the rule of DocumentActionBar.
   */
  saveDisabledReason?: string
}

/** Everything a reader can type into or press, in the order the browser would tab through it. */
const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable="true"]'

/** Marks the footer so Cancel and Save are never mistaken for the form's first field. */
const FOOTER_CLASS = 'form-modal__footer'

/**
 * The first thing in the form a reader can type into. The footer is skipped - a form with no fields
 * at all must not open with Cancel focused - and a field the browser is not painting is passed over
 * in favour of one it is, which is what keeps a collapsed or hidden field from swallowing the
 * cursor. That last test is a preference rather than a filter: the first candidate is taken anyway
 * when nothing has been laid out yet, since this runs before the modal's first paint.
 */
function firstField(form: HTMLFormElement | null): HTMLElement | null {
  if (!form) return null

  const candidates = Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest(`.${FOOTER_CLASS}`),
  )

  // A form that names its own starting field (data-autofocus) is taken at its word.
  const chosen = candidates.find((element) => element.getAttribute('data-autofocus') === 'true')
  if (chosen) return chosen

  return candidates.find((element) => element.getClientRects().length > 0) ?? candidates[0] ?? null
}

/**
 * Modal wrapper for the create/edit forms: title, body, and a right-aligned Cancel / Save footer.
 * While saving it refuses to close on a backdrop click so a half-finished request cannot be orphaned.
 *
 * **The cursor starts in the first field**, on create and on edit alike - a dialog that opens with
 * nothing focused makes the reader reach for the mouse to begin typing. It is done twice over
 * because the two halves cannot race: the field is tagged `data-autofocus`, which is what Mantine's
 * own focus trap looks for first, and a timer focuses that same field directly in case the trap has
 * already run. Both find the one node, so the second is a no-op rather than a second opinion.
 *
 * **Closing gives the focus back to whatever opened the modal** - the New button, or the row's Edit
 * icon - so the keyboard is where the reader left it. The pages mount these modals conditionally
 * (`{dialog ? <XxxModal/> : null}`), so the return is done here on unmount rather than left to
 * Mantine, which is torn down before it can see the modal close.
 */
export function FormModal({
  opened,
  title,
  children,
  onSubmit,
  onClose,
  saving = false,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  size = 'lg',
  readOnly = false,
  saveDisabled = false,
  closeOnEscape = true,
  fullScreen = false,
  saveDisabledReason,
}: FormModalProps) {
  const openerRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const phone = useMediaQuery('(max-width: 48em)')
  // The reason is said only while Save is disabled, and only by a dialog that gives one.
  const reason = saveDisabled && saveDisabledReason ? saveDisabledReason : null
  const tooltipSave = reason !== null && !phone && !readOnly

  // Read on the render that opens the dialog - before the modal exists, and so before anything has
  // taken the focus away from the button that was pressed.
  useLayoutEffect(() => {
    if (!opened) return
    openerRef.current = document.activeElement as HTMLElement | null
  }, [opened])

  /**
   * A callback ref rather than an effect, because an effect would be too early: Mantine renders the
   * modal's body into a portal that only exists from the second commit, so on the render that opens
   * the dialog there is no form to look inside yet. The ref fires exactly when there is one.
   */
  const attachForm = useCallback((form: HTMLFormElement | null) => {
    const field = firstField(form)
    if (!field) return

    field.setAttribute('data-autofocus', 'true')
    // Mantine's focus trap fires from a timer of its own and would otherwise land on the close
    // button. Whichever timer runs first, both now find this one field.
    timerRef.current = window.setTimeout(() => field.focus(), 0)
  }, [])

  useEffect(() => {
    if (!opened) return

    return () => {
      window.clearTimeout(timerRef.current)
      const opener = openerRef.current
      openerRef.current = null
      // A row action can disappear with the row it acted on; there is nothing to return to then.
      if (opener?.isConnected) opener.focus()
    }
  }, [opened])

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      fullScreen={fullScreen}
      centered={!fullScreen}
      trapFocus
      returnFocus={false}
      closeOnClickOutside={!saving}
      closeOnEscape={closeOnEscape && !saving}
      withCloseButton={!saving}
    >
      <form
        ref={attachForm}
        onSubmit={(event) => {
          event.preventDefault()
          /* ONLY THIS DIALOG'S OWN FORM SUBMITS IT. A dialog opened on top of it (rendered in a portal) bubbles its
             submit up the React tree to here, which would post this one too: ignored, as the item page does. No
             dialog held another form before script 90, so for them nothing changes. */
          if (event.target !== event.currentTarget) return
          // Enter while Save is disabled with its reason: that Save is not a disabled button (its tooltip needs the
          // hover), so the browser would submit through it. A plain disabled Save stops Enter by itself.
          if (tooltipSave) return
          onSubmit()
        }}
        noValidate
      >
        <Stack gap="md">
          {children}

          {/* A phone shows no tooltip: the reason Save is disabled stands above the footer. */}
          {reason && phone && !readOnly ? (
            <Text fz="xs" c="dimmed" ta="right">
              {reason}
            </Text>
          ) : null}

          {/* A native submit button: Enter in any single-line field submits the form. */}
          <Group className={FOOTER_CLASS} justify="flex-end" gap="sm" mt="xs">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {cancelLabel}
            </Button>
            {readOnly ? null : tooltipSave ? (
              // data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs.
              <Tooltip label={reason} withArrow multiline w={280}>
                <Button type="submit" data-disabled aria-disabled onClick={(event) => event.preventDefault()}>
                  {saveLabel}
                </Button>
              </Tooltip>
            ) : (
              <Button type="submit" loading={saving} disabled={saveDisabled}>
                {saveLabel}
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
