import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { useElementSize, useMediaQuery } from '@mantine/hooks'
import { IconDownload, IconPaperclip, IconPencil, IconTrash } from '@tabler/icons-react'
import type { AttachmentDocumentKind, DocumentFileEdit, DocumentFileFields } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import { dateLabel, stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { AttachmentEditDialog } from './AttachmentEditDialog'
import {
  AttachmentUploadDialog,
  type AttachmentOption,
  type ContainerFiling,
  type ContainerFilingValue,
} from './AttachmentUploadDialog'
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentTypeLabel, formatBytes } from './attachmentRules'

/**
 * The width the panel's table needs to read cleanly: a file name on one or two lines and Download / Edit / Delete in
 * view without scrolling. Its fixed columns (type, date, added by, the actions) take about 680 px, which leaves the
 * file name and the note about 160 px each at this width. Below it the panel shows one card per file instead.
 */
const TABLE_WIDTH = 1000

/**
 * A file name that wraps between its words: a break point after every "_" and ".", which the browser does not see as
 * places to break. Without them a long name such as "TEST-DATES_Bill_of_Lading_MSKU1234565.pdf" broke after "TEST-"
 * and then in the middle of a word. <wbr> adds nothing to the text: what is copied or searched is the name itself.
 */
function FileName({ name }: { name: string }) {
  const parts = name.split(/(?<=[_.])/)
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </Fragment>
  ))
}

/** "Purchase › Proforma Invoice" in blue, a file still typed "Other" in orange. Wraps rather than cuts the name. */
export function AttachmentTypeBadge({
  category,
  subType,
  isOther,
}: {
  category: string | null
  subType: string | null
  isOther: boolean
}) {
  return (
    <Badge
      variant="light"
      color={isOther ? 'orange' : 'blue'}
      radius="sm"
      tt="none"
      h="auto"
      py={2}
      styles={{ label: { whiteSpace: 'normal', overflow: 'visible', lineHeight: 1.3 } }}
    >
      {attachmentTypeLabel(category, subType)}
    </Badge>
  )
}

/** What every attachment list shows: the document files and the container attachments both have it. */
export interface AttachmentRow {
  id: number
  fileName: string
  sizeBytes: number
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  isOther: boolean
  documentDate: string | null
  note: string | null
  createdAtUtc: string
  createdByName: string | null
}

/** The calls behind one list: a document family's file endpoints, or a container's. */
export interface AttachmentsSource<R extends AttachmentRow> {
  list: () => Promise<R[]>
  upload: (file: File, fields: DocumentFileFields, filing: ContainerFilingValue) => Promise<unknown>
  /** Name, type / date / note and optionally a new file; allShared = every container holding it (containers only). */
  update: (row: R, edit: DocumentFileEdit, allShared: boolean) => Promise<unknown>
  download: (row: R) => Promise<void>
  /** Deletes the row; false = the reader kept it (a source that asks its own question). */
  remove: (row: R) => Promise<boolean | void>
  /** remove asks its own question (a shared container file: this container, or all of them?). */
  asksBeforeRemove?: boolean
}

export interface AttachmentGroup {
  key: string
  title: string
  order: number
}

interface AttachmentsPanelProps<R extends AttachmentRow> {
  /** The card's title; none in a drawer, which has its own. */
  title?: string
  /** Whose types the upload and edit dialogs offer. */
  documentKind: AttachmentDocumentKind
  /** Null on a document never saved: there is nothing to attach a file to yet. */
  source: AttachmentsSource<R> | null
  /** Changes when the rows must be read again: another document, or the page reloaded this one. */
  reloadKey: string | number
  /** Said instead of the list while source is null. Default "Save the draft first to attach documents." */
  unsavedText?: string
  /** A new file: the drop zone, the "Add document…" button and openUpload. Edit follows canEdit. */
  canAdd: boolean
  /**
   * Edit and the orange "Choose a type" of the files already there. Default canAdd; a page whose adding also depends
   * on a status (a cancelled charge takes no new file) passes the permission alone, so its files can still be retyped.
   */
  canEdit?: boolean
  canRemove: boolean | ((row: R) => boolean)
  /** Container pages only: where the file is filed. A function is asked when the dialog opens. */
  filing?: ContainerFiling | (() => Promise<ContainerFiling>)
  /** Sections of the list (a container: General, each movement, each charge). */
  groupOf?: (row: R) => AttachmentGroup
  /** After the file name: a container's "shared with 2 containers". */
  fileExtra?: (row: R) => ReactNode
  /** Containers holding the row's file, its own included: above one the edit asks how far it goes. */
  sharedCount?: (row: R) => number
  /**
   * Container pages only: the movements the edit popup offers under "Link to a movement" for this row; null (a
   * charge's file, which stays with its charge) or left out = no movement choice in the edit.
   */
  movementOptions?: (row: R) => AttachmentOption[] | null | undefined
  /** Said when nothing is attached yet. Default "No document yet." */
  emptyText?: string
  /** Told after every upload, edit and delete, so the page's own counts and audit trail catch up. */
  onChanged?: () => void
  /** In a Paper card (a page) or bare (a drawer). */
  card?: boolean
  /**
   * 'auto' (default): a table where the panel itself is at least TABLE_WIDTH wide, else one small card per file (a
   * phone, the left column of a container page, a movement's Documents tab). 'cards': always one card per file - for
   * a place such as a drawer, where the table never fits.
   */
  layout?: 'auto' | 'cards'
  /**
   * A page action's way to open the "Add document" popup: a counter the page bumps (setAddDocument((n) => n + 1)).
   * Every new value opens the popup with no file, once the panel has a source and canAdd; the value the panel mounts
   * with opens nothing. After an upload opened this way the panel scrolls into view, so the new row is seen.
   */
  openUpload?: number
}

/**
 * THE documents list of every document, container and item definition: the type badge ("Purchase › Proforma
 * Invoice"), the date written on the document, the note, the size, who added it and when; download, edit (name, type /
 * date / note, a new version of the file, and a container file's movement), delete; a filter by type. "Add document…",
 * dropping or picking a file all open the "Add document" popup (with the file filled in) - nothing is uploaded without
 * a type. Files still typed "Other" say so in orange next to their edit button.
 */
export function AttachmentsPanel<R extends AttachmentRow>({
  title,
  documentKind,
  source,
  reloadKey,
  unsavedText = 'Save the draft first to attach documents.',
  canAdd,
  canEdit = canAdd,
  canRemove,
  filing,
  groupOf,
  fileExtra,
  sharedCount,
  movementOptions,
  emptyText = 'No document yet.',
  onChanged,
  card = true,
  layout = 'auto',
  openUpload,
}: AttachmentsPanelProps<R>) {
  const [rows, setRows] = useState<R[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ file: File | null; filing: ContainerFiling | null } | null>(null)
  const [opening, setOpening] = useState(false)
  const [editing, setEditing] = useState<R | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // An upload asked for by the page (openUpload): once it is in, the panel scrolls into view.
  const revealAfterUpload = useRef(false)
  // One small card per file wherever the table would be cramped. Measured on the panel itself, not read from the
  // screen: at 1440 px the panel gets about 1,100 px on a document page but about 740 in the left column of a
  // container page and in a movement's Documents tab, where the table squeezed file names to a few letters per line
  // and hid Delete behind a scroll. Once it shows the table it keeps it down to 40 px under TABLE_WIDTH, so a page
  // scrollbar coming and going cannot flip it back and forth. Until the first measure, a phone gets the cards.
  // A drawer asks for the cards anyway.
  const phone = useMediaQuery('(max-width: 48em)')
  const { ref: widthRef, width } = useElementSize()
  const [wide, setWide] = useState<boolean | null>(null)
  const nextWide = width > 0 ? width >= (wide ? TABLE_WIDTH - 40 : TABLE_WIDTH) : wide
  if (nextWide !== wide) setWide(nextWide)
  const narrow = layout === 'cards' || (wide === null ? phone : !wide)

  // The source is rebuilt by its page on every render; the rows follow reloadKey, not its identity. The ref is
  // brought up to date before the effects below read it (effects run in the order they are declared).
  const sourceRef = useRef(source)
  useEffect(() => {
    sourceRef.current = source
  })
  const hasSource = source !== null

  const load = useCallback(async () => {
    const current = sourceRef.current
    if (!current) {
      setRows([])
      return
    }
    try {
      setRows(await current.list())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'The attachments could not be loaded.')
    }
  }, [])

  // The rows on screen stay while they are read again: a reload after an upload must not flash a loader.
  useEffect(() => {
    void load()
  }, [load, reloadKey, hasSource])

  async function changed(message: string) {
    notify.success(message)
    await load()
    onChanged?.()
  }

  /** Opens the popup, with the dropped or picked file; reveal = scroll into view once it is uploaded (openUpload). */
  async function startUpload(file: File | null, reveal = false) {
    revealAfterUpload.current = reveal
    if (!filing || typeof filing !== 'function') {
      setUpload({ file, filing: filing ?? null })
      return
    }
    setOpening(true)
    try {
      setUpload({ file, filing: await filing() })
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The upload could not be prepared.')
    } finally {
      setOpening(false)
    }
  }

  // The page's "Add document…" (openUpload): each new value of the counter opens the popup, the mount value does not.
  // The handler is read through a ref so the effect follows the counter alone, never a re-render of the page.
  const seenOpenRequest = useRef(openUpload)
  const openRequested = useRef<() => void>(() => {})
  useEffect(() => {
    openRequested.current = () => {
      if (!canAdd || !sourceRef.current) return
      void startUpload(null, true)
    }
  })
  useEffect(() => {
    if (openUpload === undefined || openUpload === seenOpenRequest.current) return
    seenOpenRequest.current = openUpload
    openRequested.current()
  }, [openUpload])

  async function download(row: R) {
    try {
      await sourceRef.current?.download(row)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be downloaded.')
    }
  }

  async function remove(row: R) {
    const current = sourceRef.current
    if (!current) return
    if (!current.asksBeforeRemove) {
      const go = await confirm({
        title: 'Delete document',
        message: `Delete ${row.fileName}? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!go) return
    }
    try {
      if ((await current.remove(row)) === false) return
      await changed(`${row.fileName} deleted.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be deleted.')
      await load()
    }
  }

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows ?? [])
      seen.set(String(row.attachmentTypeId ?? 0), attachmentTypeLabel(row.category, row.subType))
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  // A filter on a type no file has any more (the last one was retyped) falls back to every type.
  const activeFilter = typeFilter !== null && typeOptions.some((o) => o.value === typeFilter) ? typeFilter : null
  const shown = useMemo(
    () => (rows ?? []).filter((row) => activeFilter === null || String(row.attachmentTypeId ?? 0) === activeFilter),
    [rows, activeFilter],
  )

  const groups = useMemo(() => {
    if (!groupOf) return [{ key: 'all', title: '', order: 0, rows: shown }]
    const map = new Map<string, AttachmentGroup & { rows: R[] }>()
    for (const row of shown) {
      const g = groupOf(row)
      const group = map.get(g.key) ?? { ...g, rows: [] }
      group.rows.push(row)
      map.set(g.key, group)
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  }, [shown, groupOf])

  const mayRemove = (row: R) => (typeof canRemove === 'function' ? canRemove(row) : canRemove)

  /** The orange hint of a file still typed "Other": it is the edit button. */
  const chooseType = (row: R) =>
    canEdit && row.isOther ? (
      <Button
        size="compact-xs"
        variant="light"
        color="orange"
        leftSection={<IconPencil size={12} />}
        onClick={() => setEditing(row)}
      >
        Choose a type
      </Button>
    ) : null

  const actions = (row: R) => (
    <Group gap={4} justify="flex-end" wrap="nowrap">
      <Tooltip label="Download" withArrow>
        <ActionIcon variant="subtle" aria-label={`Download ${row.fileName}`} onClick={() => void download(row)}>
          <IconDownload size={16} />
        </ActionIcon>
      </Tooltip>
      {canEdit ? (
        <Tooltip label="Edit" withArrow>
          <ActionIcon variant="subtle" aria-label={`Edit ${row.fileName}`} onClick={() => setEditing(row)}>
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
      ) : null}
      {mayRemove(row) ? (
        <Tooltip label="Delete" withArrow>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Delete ${row.fileName}`}
            onClick={() => void remove(row)}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </Group>
  )

  const toolbar = (
    <Group gap="xs" wrap="wrap" justify={title ? 'flex-end' : 'space-between'} style={{ flex: 1 }}>
      {(rows?.length ?? 0) > 0 ? (
        <Select
          size="xs"
          w={240}
          aria-label="Filter by type"
          placeholder="Every type"
          data={typeOptions}
          value={activeFilter}
          onChange={setTypeFilter}
          clearable
        />
      ) : (
        <span />
      )}
      {canAdd && hasSource ? (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPaperclip size={14} />}
          loading={opening}
          onClick={() => void startUpload(null)}
        >
          Add document…
        </Button>
      ) : null}
    </Group>
  )

  const body = (
    <Stack gap="sm" ref={widthRef}>
      {!hasSource ? (
        <Alert color="blue" variant="light">
          {unsavedText}
        </Alert>
      ) : (
        <>
          {canAdd ? (
            <Box
              data-attachment-drop
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer.files?.[0]
                if (file) void startUpload(file)
              }}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `1px dashed var(--mantine-color-${dragging ? 'blue' : 'gray'}-4)`,
                borderRadius: 'var(--mantine-radius-md)',
                padding: 'var(--mantine-spacing-xs) var(--mantine-spacing-md)',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragging ? 'var(--mantine-color-blue-0)' : undefined,
              }}
            >
              <input
                ref={inputRef}
                type="file"
                hidden
                accept={ATTACHMENT_ACCEPT}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) void startUpload(file)
                }}
              />
              <Text fz="sm" fw={500}>
                Drop a file here, or click to choose one
              </Text>
              <Text fz="xs" c="dimmed">
                {ATTACHMENT_HINT}. You pick its type before it is uploaded.
              </Text>
            </Box>
          ) : null}

          {loadError ? <Alert color="red">{loadError}</Alert> : null}

          {rows === null ? (
            <Group justify="center" py="sm">
              <Loader size="sm" />
            </Group>
          ) : rows.length === 0 ? (
            <Text c="dimmed" fz="sm" ta="center" py="sm">
              {emptyText}
            </Text>
          ) : shown.length === 0 ? (
            <Text c="dimmed" fz="sm" ta="center" py="sm">
              No file of this type.
            </Text>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                {groupOf ? (
                  <Text fz="sm" fw={600} mb={4}>
                    {group.title}{' '}
                    <Text span c="dimmed" fz="xs">
                      ({formatNumber(group.rows.length)})
                    </Text>
                  </Text>
                ) : null}
                {narrow ? (
                  <Stack gap="xs">
                    {group.rows.map((row) => (
                      <Paper key={row.id} withBorder radius="md" p="xs" data-attachment-row={row.fileName}>
                        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                          <Stack gap={4} align="flex-start" style={{ minWidth: 0 }}>
                            <AttachmentTypeBadge category={row.category} subType={row.subType} isOther={row.isOther} />
                            <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                              <FileName name={row.fileName} />
                            </Text>
                            <Text fz="xs" c="dimmed">
                              {[
                                row.documentDate ? dateLabel(row.documentDate) : null,
                                formatBytes(row.sizeBytes),
                                row.createdByName,
                                stamp(row.createdAtUtc),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                            {row.note ? (
                              <Text fz="sm" style={{ overflowWrap: 'anywhere' }}>
                                {row.note}
                              </Text>
                            ) : null}
                            {fileExtra?.(row)}
                            {chooseType(row)}
                          </Stack>
                          {actions(row)}
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <ScrollArea type="auto">
                    <Table miw={760} verticalSpacing={6}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={200}>Type</Table.Th>
                          <Table.Th>File</Table.Th>
                          <Table.Th w={100}>Date</Table.Th>
                          <Table.Th>Note</Table.Th>
                          <Table.Th w={170}>Added by</Table.Th>
                          <Table.Th w={1} />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {group.rows.map((row) => (
                          <Table.Tr key={row.id} data-attachment-row={row.fileName}>
                            <Table.Td>
                              <Stack gap={4} align="flex-start">
                                <AttachmentTypeBadge
                                  category={row.category}
                                  subType={row.subType}
                                  isOther={row.isOther}
                                />
                                {chooseType(row)}
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm" style={{ overflowWrap: 'anywhere' }}>
                                <FileName name={row.fileName} />
                              </Text>
                              <Group gap={6} mt={2}>
                                <Text fz="xs" c="dimmed">
                                  {formatBytes(row.sizeBytes)}
                                </Text>
                                {fileExtra?.(row)}
                              </Group>
                            </Table.Td>
                            <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(row.documentDate)}</Table.Td>
                            <Table.Td>
                              <Text fz="sm" c={row.note ? undefined : 'dimmed'} style={{ overflowWrap: 'anywhere' }}>
                                {row.note ?? '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm">{row.createdByName ?? '—'}</Text>
                              <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                {stamp(row.createdAtUtc)}
                              </Text>
                            </Table.Td>
                            <Table.Td>{actions(row)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </div>
            ))
          )}
        </>
      )}

      <AttachmentUploadDialog
        opened={upload !== null}
        documentKind={documentKind}
        initialFile={upload?.file ?? null}
        filing={upload?.filing ?? null}
        onUpload={(file, fields, value) => {
          if (!sourceRef.current) return Promise.resolve()
          return sourceRef.current.upload(file, fields, value)
        }}
        onClose={() => setUpload(null)}
        onUploaded={(fileName) => {
          setUpload(null)
          const reveal = revealAfterUpload.current
          revealAfterUpload.current = false
          void changed(`${fileName} attached.`).then(() => {
            if (reveal) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          })
        }}
      />

      <AttachmentEditDialog
        file={editing}
        documentKind={documentKind}
        sharedCount={editing && sharedCount ? sharedCount(editing) : 1}
        movementOptions={editing && movementOptions ? movementOptions(editing) : null}
        onSave={(edit, allShared) => {
          if (!sourceRef.current || !editing) return Promise.resolve()
          return sourceRef.current.update(editing, edit, allShared)
        }}
        onClose={() => setEditing(null)}
        onSaved={() => {
          const name = editing?.fileName ?? 'The attachment'
          setEditing(null)
          void changed(`${name} updated.`)
        }}
      />
    </Stack>
  )

  if (!card) {
    return (
      <Stack gap="sm" ref={rootRef}>
        {toolbar}
        {body}
      </Stack>
    )
  }

  return (
    <Paper radius="lg" p="md" withBorder ref={rootRef}>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>
          {title}{' '}
          {rows && rows.length > 0 ? (
            <Text span c="dimmed" fz="sm" fw={400}>
              ({formatNumber(rows.length)})
            </Text>
          ) : null}
        </Title>
        {toolbar}
      </Group>
      {body}
    </Paper>
  )
}
