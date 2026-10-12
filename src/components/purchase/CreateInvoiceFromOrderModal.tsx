import { useEffect, useState } from 'react'
import { Alert, Loader, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core'
import { ApiError } from '../../api/http'
import { purchaseDocumentsApi, type CreatedPurchaseInvoicesDto, type PurchaseDocumentDto } from '../../api/purchase/documents'
import { FormModal } from '../ui/FormModal'
import { distinctInOrder, oneInvoiceLine, onePerItemDescription, onePerItemLine, onePerItemToSend, useOneItemPerInvoice } from './onePerItem'

interface CreateInvoiceFromOrderModalProps {
  /** The order, when the page already holds it; otherwise it is read by id. */
  order?: PurchaseDocumentDto
  orderId: number
  onClose: () => void
  onCreated: (created: CreatedPurchaseInvoicesDto) => void
}

/**
 * "Create Purchase Invoice" on an approved order: what remains to invoice becomes ONE DRAFT PER ITEM, or one
 * draft holding every item. "One invoice per item" starts from the setting (Purchase.OneItemPerInvoice) and is
 * chosen for this creation only. The dialog says how many before anything is made, and takes the exporter's
 * reference and the commercial invoice number once for all of them.
 */
export function CreateInvoiceFromOrderModal({ order: given, orderId, onClose, onCreated }: CreateInvoiceFromOrderModalProps) {
  const [order, setOrder] = useState<PurchaseDocumentDto | null>(given ?? null)
  const [exporterReference, setExporterReference] = useState('')
  const [commercialInvoiceNo, setCommercialInvoiceNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /* THE SETTING IS THE DEFAULT, THE SWITCH THE CHOICE: null until the reader flips it, so a setting read late still applies. */
  const setting = useOneItemPerInvoice()
  const [choice, setChoice] = useState<boolean | null>(null)
  const onePerItem = choice ?? setting.value

  useEffect(() => {
    if (given) return
    let live = true
    purchaseDocumentsApi
      .get(orderId)
      .then((loaded) => live && setOrder(loaded))
      .catch((err: unknown) => live && setError(err instanceof ApiError ? err.message : 'The order could not be loaded.'))
    return () => {
      live = false
    }
  }, [given, orderId])

  /* The items still to invoice, in the order of their first line: one invoice each, or one invoice for all. */
  const itemCodes = distinctInOrder((order?.lines ?? []).filter((line) => (line.remainingBase ?? 0) > 0).map((line) => line.itemCode))

  /* NOTHING LEFT TO INVOICE: since goods receipts a fully invoiced order stays open until its goods are received, so the
     order list can still reach this dialog for it. Said here instead of a Create the server would refuse (65011). An
     order line's remainingBase counts the draft invoices as not invoiced yet, so the rest may be all in drafts. */
  const leftToInvoice = (order?.lines ?? []).reduce((sum, line) => sum + Math.max(0, line.remainingBase ?? 0), 0)
  const nothingLeft =
    order === null
      ? null
      : leftToInvoice <= 0 || order.canCreateInvoice === false
        ? 'Everything ordered is already invoiced.'
        : leftToInvoice <= order.inDraftInvoicesBase
          ? 'The rest of this order is already in draft invoices: post or delete them first.'
          : null

  async function create() {
    setSaving(true)
    setError(null)
    try {
      // Not flipped and the setting not read (still loading, or unreadable): null, and the server applies the setting itself.
      const sent = onePerItemToSend(choice, setting)
      onCreated(await purchaseDocumentsApi.createInvoice(orderId, null, { exporterReference, commercialInvoiceNo }, sent))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The invoice could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      onClose={onClose}
      title="Create purchase invoice"
      size="lg"
      saving={saving}
      saveLabel={onePerItem && itemCodes.length > 1 ? `Create ${itemCodes.length} invoices` : 'Create invoice'}
      saveDisabled={order === null || nothingLeft !== null}
      onSubmit={() => void create()}
    >
      <Stack gap="md">
        <Text fz="sm">
          Create purchase invoice drafts from {order?.documentNumber ?? `order #${orderId}`} with everything that remains to invoice?
        </Text>
        {order === null && !error ? <Loader size="sm" /> : null}
        {nothingLeft ? (
          <Alert color="orange" data-nothing-to-invoice>
            {nothingLeft}
          </Alert>
        ) : null}
        <Switch
          label="One invoice per item"
          description={onePerItemDescription('Off: one invoice holds every item.', choice, setting)}
          checked={onePerItem}
          disabled={setting.loading && choice === null}
          onChange={(event) => setChoice(event.currentTarget.checked)}
          data-one-per-item-switch
        />
        {itemCodes.length > 0 && nothingLeft === null ? (
          <Alert color="blue" variant="light" data-one-invoice-per-item={onePerItem}>
            {onePerItem ? onePerItemLine(itemCodes) : oneInvoiceLine(itemCodes.length)}
            {order && order.inDraftInvoicesBase > 0 ? (
              <Text fz="xs" c="dimmed" mt={4}>
                What is already in draft invoices of this order is left out.
              </Text>
            ) : null}
          </Alert>
        ) : null}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            label="Exporter's ref."
            description="copied to every invoice"
            maxLength={50}
            value={exporterReference}
            onChange={(event) => setExporterReference(event.currentTarget.value)}
          />
          <TextInput
            label="Commercial invoice no."
            description="copied to every invoice"
            maxLength={50}
            value={commercialInvoiceNo}
            onChange={(event) => setCommercialInvoiceNo(event.currentTarget.value)}
          />
        </SimpleGrid>
        {error ? <Alert color="red">{error}</Alert> : null}
      </Stack>
    </FormModal>
  )
}
