import { useEffect, useState } from 'react'
import { Alert, Loader, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { ApiError } from '../../api/http'
import { purchaseDocumentsApi, type CreatedPurchaseInvoicesDto, type PurchaseDocumentDto } from '../../api/purchase/documents'
import { FormModal } from '../ui/FormModal'
import { distinctInOrder, onePerItemLine } from './onePerItem'

interface CreateInvoiceFromOrderModalProps {
  /** The order, when the page already holds it; otherwise it is read by id. */
  order?: PurchaseDocumentDto
  orderId: number
  onClose: () => void
  onCreated: (created: CreatedPurchaseInvoicesDto) => void
}

/**
 * "Create Purchase Invoice" on an approved order: what remains to receive becomes ONE DRAFT PER ITEM
 * (a supplier invoice holds one item). The dialog says how many before anything is made, and takes the
 * exporter's reference and the commercial invoice number once for all of them.
 */
export function CreateInvoiceFromOrderModal({ order: given, orderId, onClose, onCreated }: CreateInvoiceFromOrderModalProps) {
  const [order, setOrder] = useState<PurchaseDocumentDto | null>(given ?? null)
  const [exporterReference, setExporterReference] = useState('')
  const [commercialInvoiceNo, setCommercialInvoiceNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  /* The items still to receive, in the order of their first line: one invoice each. */
  const itemCodes = distinctInOrder((order?.lines ?? []).filter((line) => (line.remainingBase ?? 0) > 0).map((line) => line.itemCode))

  async function create() {
    setSaving(true)
    setError(null)
    try {
      onCreated(await purchaseDocumentsApi.createInvoice(orderId, null, { exporterReference, commercialInvoiceNo }))
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
      saveLabel={itemCodes.length > 1 ? `Create ${itemCodes.length} invoices` : 'Create invoice'}
      saveDisabled={order === null}
      onSubmit={() => void create()}
    >
      <Stack gap="md">
        <Text fz="sm">
          Create purchase invoice drafts from {order?.documentNumber ?? `order #${orderId}`} with everything that remains to receive?
        </Text>
        {order === null && !error ? <Loader size="sm" /> : null}
        {itemCodes.length > 0 ? (
          <Alert color="blue" variant="light" data-one-invoice-per-item>
            {onePerItemLine(itemCodes)}
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
