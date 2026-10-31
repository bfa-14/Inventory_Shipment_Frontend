import { useRef, useState } from 'react'
import { Loader, Paper, Popover, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { IconBarcode } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { ItemListDto } from '../../api/types'
import { notify } from '../ui/notify'

interface QuickItemSearchProps {
  disabled?: boolean
  /**
   * Called with the item the operator settled on. The page decides what a line made of it looks like. `term` is what
   * was scanned or typed (trimmed), for a page that takes the unit whose barcode it is (the transfer order, script 90);
   * the other pages leave it out.
   */
  onPick: (item: ItemListDto, term: string) => void
  /**
   * Only items with "BIVAC Item" ticked: a document type whose bivacItemsOnly is set (BIVAC Out). The
   * search itself is narrowed, so a code of another item is "not found" here rather than a line the
   * server would refuse on saving.
   */
  bivacOnly?: boolean
}

/**
 * The scanner's way in: type or scan a code, press Enter, and the line is there.
 *
 * THIS IS THE FAST PATH AND IT HAS TO STAY FAST. Somebody counting a delivery holds a scanner in
 * one hand and the goods in the other; every extra click is one they make three hundred times. So
 * the box keeps the focus after each scan, an exact match is added without confirmation, and the
 * dropdown only appears when the code was genuinely ambiguous.
 *
 * IT SEARCHES RATHER THAN LOOKS UP, deliberately. The lookup endpoint returns codes and names; a
 * barcode belongs to a UNIT, and only the search endpoint matches one. A scanner that could not
 * resolve the barcode on the box would be a scanner nobody uses.
 */
export function QuickItemSearch({ disabled, onPick, bivacOnly = false }: QuickItemSearchProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [matches, setMatches] = useState<ItemListDto[]>([])
  /** The term the ambiguous matches were found for: a pick from the list was scanned as that. */
  const [matchTerm, setMatchTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    const term = text.trim()
    if (term === '' || busy) return

    setBusy(true)
    setMatches([])
    try {
      const found = await itemsApi.search({
        search: term,
        isActive: true,
        isBivac: bivacOnly ? true : undefined,
        page: 1,
        pageSize: 10,
      })
      const items = found.items

      if (items.length === 0) {
        notify.error(bivacOnly ? `No BIVAC item matches ${term}.` : `Item ${term} not found`)
        return
      }

      /* AN EXACT CODE MATCH WINS OUTRIGHT, even when the term also matches others as a substring:
         somebody who typed a whole item code meant that item, and offering them a list to confirm
         their own code would be the thing that makes the fast path slow. */
      const exact = items.find((i) => i.itemCode.toLowerCase() === term.toLowerCase())
      if (exact || items.length === 1) {
        take(exact ?? items[0], term)
        return
      }

      setMatchTerm(term)
      setMatches(items)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The item could not be looked up.')
    } finally {
      setBusy(false)
    }
  }

  function take(item: ItemListDto, term: string) {
    onPick(item, term)
    setText('')
    setMatches([])
    // Straight back to the box: the next scan is already on its way.
    inputRef.current?.focus()
  }

  return (
    <Popover opened={matches.length > 0} onDismiss={() => setMatches([])} position="bottom-start" width={340} shadow="md">
      <Popover.Target>
        <TextInput
          ref={inputRef}
          label="Quick Item Search"
          placeholder="Scan barcode or enter item code and press Enter"
          leftSection={busy ? <Loader size={16} /> : <IconBarcode size={18} />}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // The document page has no form element, but a scanner sends Enter and some browsers
              // still treat it as a submit; stopping it keeps the page from reloading mid-count.
              event.preventDefault()
              void submit()
            }
            if (event.key === 'Escape') setMatches([])
          }}
        />
      </Popover.Target>

      {/* Only when the code was ambiguous. Codes and names together, because two items whose codes
          both start with the same letters are told apart by their names, not by their codes. */}
      <Popover.Dropdown p={4}>
        <Stack gap={2}>
          <Text size="xs" c="dimmed" px="xs" pt={4}>
            {matches.length} items match — pick one
          </Text>
          {matches.map((item) => (
            <UnstyledButton key={item.id} onClick={() => take(item, matchTerm)}>
              <Paper p="xs" radius="sm" withBorder={false} className="quick-pick">
                <Text size="sm" fw={500}>
                  {item.itemCode}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.itemName}
                </Text>
              </Paper>
            </UnstyledButton>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
