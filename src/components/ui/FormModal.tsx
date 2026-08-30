import type { ReactNode } from 'react'
import { Button, Group, Modal, Stack } from '@mantine/core'

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
}

/**
 * Modal wrapper for the create/edit forms: title, body, and a right-aligned Cancel / Save footer.
 * While saving it refuses to close on a backdrop click so a half-finished request cannot be orphaned.
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
}: FormModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      trapFocus
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        noValidate
      >
        <Stack gap="md">
          {children}

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {cancelLabel}
            </Button>
            <Button type="submit" loading={saving}>
              {saveLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
