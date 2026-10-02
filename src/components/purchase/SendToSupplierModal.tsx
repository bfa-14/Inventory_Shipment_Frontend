import { useState } from 'react'
import { Button, Group, Modal, Stack, Text, TextInput, Textarea } from '@mantine/core'

interface SendToSupplierModalProps {
  opened: boolean
  onClose: () => void
  /** "PO-2026-0012 to TVS Motor Company", in the title. */
  documentLabel: string
  /** The supplier's address on file: the To field starts with it. */
  supplierEmail: string | null
  busy?: boolean
  onSend: (payload: { to: string; cc: string | null; message: string | null }) => void
}

/** One or several addresses separated by ";" or "," — every one of them has to look like an address. */
function addressesError(value: string, required: boolean): string | null {
  const parts = value.split(/[;,]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return required ? 'Enter at least one address.' : null
  const bad = parts.find((part) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part))
  return bad ? `"${bad}" is not an email address.` : null
}

/**
 * The approved order to the supplier again — or for the first time, when it could not go at the
 * approval (no address on the supplier). The server sends the same email the approval sends: the order
 * and its Excel file, with this message as the first paragraph.
 */
export function SendToSupplierModal({ opened, onClose, documentLabel, supplierEmail, busy, onSend }: SendToSupplierModalProps) {
  // The form is a child so closing forgets it: the next opening starts from the supplier's address again.
  return (
    <Modal opened={opened} onClose={onClose} title={`Send ${documentLabel} to the supplier`} centered size="lg">
      <SendForm onClose={onClose} supplierEmail={supplierEmail} busy={busy} onSend={onSend} />
    </Modal>
  )
}

function SendForm({ onClose, supplierEmail, busy, onSend }: Omit<SendToSupplierModalProps, 'opened' | 'documentLabel'>) {
  const [to, setTo] = useState(supplierEmail ?? '')
  const [cc, setCc] = useState('')
  const [message, setMessage] = useState('')
  const [touched, setTouched] = useState(false)

  const toError = addressesError(to, true)
  const ccError = addressesError(cc, false)

  function submit() {
    setTouched(true)
    if (toError || ccError) return
    onSend({ to: to.trim(), cc: cc.trim() || null, message: message.trim() || null })
  }

  return (
    <Stack>
      <Text size="sm">The order goes with its Excel file. Separate several addresses with ";".</Text>
      <TextInput
        label="To"
        withAsterisk
        value={to}
        onChange={(event) => setTo(event.currentTarget.value)}
        error={touched ? toError : null}
        maxLength={1000}
        data-autofocus
      />
      <TextInput label="CC" value={cc} onChange={(event) => setCc(event.currentTarget.value)} error={touched ? ccError : null} maxLength={1000} />
      <Textarea
        label="Message"
        placeholder="Optional: the first paragraph of the email."
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
        autosize
        minRows={3}
        maxLength={2000}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="indigo" loading={busy} onClick={submit}>
          Send
        </Button>
      </Group>
    </Stack>
  )
}
