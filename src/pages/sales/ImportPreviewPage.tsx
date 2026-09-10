import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { PageHeader } from '../../components/ui/PageHeader'
import { notify } from '../../components/ui/notify'
import {
  ImportInvoiceItemsWizard,
  type ImportedLine,
} from '../../components/sales/ImportInvoiceItemsWizard'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import { priceListsApi } from '../../api/masterdata/priceLists'

/**
 * A HOST FOR THE WIZARD, AND NOTHING ELSE.
 *
 * US-SAL-002 built the import engine before the screen that will use it, so this page exists to
 * prove the wizard works end to end: pick a branch, a warehouse and a price list, import a file, and
 * watch the lines arrive in a grid with totals. It saves nothing and it is not a feature.
 *
 * WHEN THE SALES INVOICE PAGE ARRIVES this page goes and the invoice renders the same component from
 * its own "Import from Excel" button, passing its own header and appending to its own lines. That is
 * the whole reason the wizard takes a header and returns lines rather than knowing about invoices.
 */

/** One line of the sandbox grid. The import fills these in; the grid lets them be edited. */
interface PreviewLine extends ImportedLine {
  key: string
}

interface Lookup {
  value: string
  label: string
}

export function ImportPreviewPage() {
  const [branches, setBranches] = useState<Lookup[]>([])
  const [warehouses, setWarehouses] = useState<Lookup[]>([])
  const [priceLists, setPriceLists] = useState<{ id: number; label: string; currencyCode: string; decimalPlaces: number }[]>([])

  const [branchId, setBranchId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [priceListId, setPriceListId] = useState<string | null>(null)

  const [wizardOpen, setWizardOpen] = useState(false)
  const [lines, setLines] = useState<PreviewLine[]>([])

  useEffect(() => {
    branchesApi
      .lookup()
      .then((rows) => setBranches(rows.map((b) => ({ value: String(b.id), label: b.branchName }))))
      .catch(() => notify.error('Branches could not be loaded.'))

    priceListsApi
      .lookup()
      .then((rows) =>
        setPriceLists(
          rows.map((p) => ({
            id: p.id,
            label: `${p.priceListName} (${p.currencyCode})`,
            currencyCode: p.currencyCode,
            decimalPlaces: p.decimalPlaces ?? 2,
          })),
        ),
      )
      .catch(() => notify.error('Price lists could not be loaded.'))
  }, [])

  /*
   * The warehouse list belongs to the branch, so it is refetched with it.
   *
   * CLEARING THE CHOICE HAPPENS IN THE HANDLER, NOT HERE. Emptying the list and the selection is a
   * consequence of the reader picking a different branch — an event — and doing it in an effect
   * would be a second render triggered by the first. The effect keeps only the part that talks to an
   * external system, which is the fetch.
   *
   * The cancelled flag is not decoration: two quick branch changes race, and without it the slower
   * answer can arrive last and fill the list with the wrong branch's warehouses.
   */
  useEffect(() => {
    if (!branchId) return

    let cancelled = false
    warehousesApi
      .lookup(true, Number(branchId))
      .then((rows) => {
        if (!cancelled) setWarehouses(rows.map((w) => ({ value: String(w.id), label: w.warehouseName })))
      })
      .catch(() => {
        if (!cancelled) notify.error('Warehouses could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [branchId])

  /** Picking a branch invalidates the warehouse beneath it, so both are cleared with it. */
  function chooseBranch(next: string | null) {
    setBranchId(next)
    setWarehouseId(null)
    setWarehouses([])
  }

  const priceList = priceLists.find((p) => String(p.id) === priceListId)
  const currency = priceList?.currencyCode ?? 'USD'
  const decimals = priceList?.decimalPlaces ?? 2

  const ready = branchId !== null && warehouseId !== null && priceListId !== null

  const totals = useMemo(() => {
    let subtotal = 0
    let discount = 0
    for (const line of lines) {
      const gross = line.quantity * (line.unitPrice ?? 0)
      subtotal += gross
      discount += gross * (line.discountPercent / 100)
    }
    return { subtotal, discount, grand: subtotal - discount }
  }, [lines])

  const money = (value: number) => `${value.toFixed(decimals)} ${currency}`

  function appendImported(imported: ImportedLine[]) {
    setLines((current) => [
      ...current,
      ...imported.map((line, index) => ({
        ...line,
        // Unique across repeated imports: the Excel row number alone repeats when the same file is
        // imported twice, and React would then reuse a row's state for a different line.
        key: `${Date.now()}-${index}-${line.importRowNumber}`,
      })),
    ])
    notify.success(`${imported.length} line(s) added.`)
  }

  function update(key: string, patch: Partial<PreviewLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <Stack>
      <PageHeader title="Import Items (preview)" />

      <Alert color="blue" title="Preview page">
        Preview page — the wizard will move to the Sales Invoice screen. Nothing here is saved.
      </Alert>

      <Card withBorder>
        <Title order={5} mb="sm">
          Document header
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select
            label="Branch"
            placeholder="Choose a branch"
            data={branches}
            value={branchId}
            onChange={chooseBranch}
            searchable
          />
          <Select
            label="Default warehouse"
            placeholder={branchId ? 'Choose a warehouse' : 'Choose a branch first'}
            data={warehouses}
            value={warehouseId}
            onChange={setWarehouseId}
            disabled={!branchId}
            searchable
          />
          <Select
            label="Price list"
            placeholder="Choose a price list"
            data={priceLists.map((p) => ({ value: String(p.id), label: p.label }))}
            value={priceListId}
            onChange={setPriceListId}
            searchable
          />
          <Group align="flex-end">
            <Button
              disabled={!ready}
              onClick={() => setWizardOpen(true)}
              title={ready ? undefined : 'Choose a branch, warehouse and price list first'}
            >
              Import from Excel
            </Button>
          </Group>
        </SimpleGrid>
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Lines</Title>
          {lines.length > 0 && (
            <Button variant="subtle" color="red" size="xs" onClick={() => setLines([])}>
              Clear all
            </Button>
          )}
        </Group>

        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={50}>#</Table.Th>
                <Table.Th>Item</Table.Th>
                <Table.Th>Unit</Table.Th>
                <Table.Th>Warehouse</Table.Th>
                <Table.Th ta="right">Qty</Table.Th>
                <Table.Th ta="right">Price</Table.Th>
                <Table.Th ta="right">Discount %</Table.Th>
                <Table.Th ta="right">Line total</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line, index) => {
                const total = line.quantity * (line.unitPrice ?? 0) * (1 - line.discountPercent / 100)
                return (
                  <Table.Tr key={line.key}>
                    <Table.Td>{index + 1}</Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {line.itemCode}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {line.itemName}
                      </Text>
                    </Table.Td>
                    <Table.Td>{line.unitTypeName}</Table.Td>
                    <Table.Td>{line.warehouseCode}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        value={line.quantity}
                        min={1}
                        w={90}
                        onChange={(v) => update(line.key, { quantity: typeof v === 'number' ? v : 1 })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        value={line.unitPrice ?? 0}
                        min={0}
                        decimalScale={decimals}
                        w={120}
                        onChange={(v) => update(line.key, { unitPrice: typeof v === 'number' ? v : 0 })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        value={line.discountPercent}
                        min={0}
                        max={100}
                        w={90}
                        onChange={(v) =>
                          update(line.key, { discountPercent: typeof v === 'number' ? v : 0 })
                        }
                      />
                    </Table.Td>
                    <Table.Td ta="right">{money(total)}</Table.Td>
                    <Table.Td>
                      <TextInput
                        value={line.notes ?? ''}
                        w={160}
                        onChange={(e) => update(line.key, { notes: e.currentTarget.value })}
                      />
                    </Table.Td>
                  </Table.Tr>
                )
              })}

              {lines.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={9}>
                    <Text ta="center" c="dimmed" py="xl">
                      No lines yet. Choose a header above and press “Import from Excel”.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {lines.length > 0 && (
          <Group justify="flex-end" mt="md">
            <Stack gap={4} align="flex-end">
              <Text size="sm">Subtotal: {money(totals.subtotal)}</Text>
              <Text size="sm">Total discount: {money(totals.discount)}</Text>
              <Text fw={700}>Grand total: {money(totals.grand)}</Text>
            </Stack>
          </Group>
        )}
      </Card>

      {ready && (
        <ImportInvoiceItemsWizard
          opened={wizardOpen}
          onClose={() => setWizardOpen(false)}
          header={{
            branchId: Number(branchId),
            warehouseId: Number(warehouseId),
            priceListId: Number(priceListId),
            currencyCode: currency,
            decimalPlaces: decimals,
          }}
          mode="invoice"
          draftReference="PREVIEW-DRAFT"
          onImported={appendImported}
        />
      )}
    </Stack>
  )
}
