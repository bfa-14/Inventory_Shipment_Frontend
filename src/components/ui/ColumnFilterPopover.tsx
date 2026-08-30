import { useState } from 'react'
import { Button, Checkbox, Divider, Group, Radio, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { mergeFilter, type ColumnFilterValue } from './gridFilters'

/**
 * The contents of a column's filter popover - the funnel from the previous application, rebuilt on
 * mantine-datatable's `filter` slot: a "contains" box over a tick list of the column's distinct
 * values, with Clear / Cancel / OK.
 *
 * Nothing is applied until OK, which is what stops six ticks re-filtering (or, on a grid that pages
 * on the server, re-fetching) six times. The popover unmounts when it closes, so the draft below is
 * seeded fresh on every open and a dismissed popover leaves the grid exactly as it found it.
 *
 * It does not own the filter. The caller passes the value in force and takes the new one, so the
 * same control serves a grid holding all its rows (state from `useGridFilters`) and one that pages
 * on the server (state derived from, and written back to, that page's query).
 */

/** Above this many distinct values the tick list grows a search box of its own. */
const SEARCH_THRESHOLD = 10

/** What the single-choice list calls "not filtering" - it needs a pickable option of its own. */
const ANY = '(All)'

export interface ColumnFilterPopoverProps {
  /** The column's caption, used for the accessible names inside the popover. */
  label: string
  /** The filter currently in force on this column, or undefined when it is not filtering. */
  value: ColumnFilterValue | undefined
  /** Called on OK and on Clear, never while the reader is still ticking. */
  onApply(value: ColumnFilterValue | undefined): void
  /** The distinct values to offer. Omitted leaves the popover with the contains box alone. */
  options?: string[]
  /** Drop the contains box on a column whose values are a closed set worth only ticking. */
  withText?: boolean
  placeholder?: string
  /**
   * Offer the values as a one-of-many choice rather than tick boxes. For a column filtered on the
   * server by a parameter that takes a single value - a control that let three be ticked and then
   * sent one would be lying about what it did.
   */
  single?: boolean
  /** Closes the popover; handed in by mantine-datatable. */
  close(): void
}

export function ColumnFilterPopover({
  label,
  value,
  onApply,
  options,
  withText = true,
  placeholder = 'Contains...',
  single = false,
  close,
}: ColumnFilterPopoverProps) {
  const list = options ?? []

  const [text, setText] = useState(value?.text ?? '')
  /**
   * Seeded from what is in force, INTERSECTED with what still exists - a reload that drops a value
   * must not leave a tick nobody can see or clear. Nothing in force means everything is ticked,
   * which is what makes "Select all" read as ticked on a fresh funnel.
   */
  const [ticked, setTicked] = useState<string[]>(() =>
    value?.values ? list.filter((option) => value.values?.includes(option)) : single ? [] : list,
  )
  const [search, setSearch] = useState('')

  const needle = search.trim().toLowerCase()
  const visible = needle ? list.filter((option) => option.toLowerCase().includes(needle)) : list

  const allTicked = list.length > 0 && ticked.length === list.length
  const someTicked = ticked.length > 0 && !allTicked

  function apply() {
    // Everything ticked and nothing ticked both mean "this column is not narrowing by value".
    // Storing nothing for the empty case is what stops an accidental untick-all-then-OK blanking
    // the grid; for the single-choice list it is what (All) means.
    const byValue = list.length === 0 || allTicked || ticked.length === 0 ? undefined : ticked
    onApply(mergeFilter(undefined, { text, values: byValue }))
    close()
  }

  function clear() {
    onApply(undefined)
    close()
  }

  return (
    <Stack gap="xs" w={240}>
      {withText ? (
        <TextInput
          size="xs"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
          }}
          placeholder={placeholder}
          aria-label={`Filter ${label} by text`}
          data-autofocus
        />
      ) : null}

      {list.length > 0 ? (
        <>
          {withText ? <Divider /> : null}

          {single ? null : (
            <Checkbox
              size="xs"
              label="Select all"
              checked={allTicked}
              indeterminate={someTicked}
              onChange={(event) => {
                // Read the event synchronously: React clears currentTarget before a functional
                // updater runs, so reading it in there would throw on the first tick.
                const checked = event.currentTarget.checked
                setTicked(checked ? list : [])
              }}
            />
          )}

          {list.length > SEARCH_THRESHOLD ? (
            <TextInput
              size="xs"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              leftSection={<IconSearch size={12} />}
              placeholder="Search values"
              aria-label={`Search ${label} values`}
            />
          ) : null}

          <ScrollArea.Autosize mah={200} type="auto">
            {visible.length === 0 ? (
              <Text fz="xs" c="dimmed">
                No value matches.
              </Text>
            ) : single ? (
              <Radio.Group
                value={ticked[0] ?? ANY}
                onChange={(picked) => setTicked(picked === ANY ? [] : [picked])}
                aria-label={label}
              >
                <Stack gap={4}>
                  <Radio size="xs" value={ANY} label={ANY} />
                  {visible.map((option) => (
                    <Radio key={option} size="xs" value={option} label={option} />
                  ))}
                </Stack>
              </Radio.Group>
            ) : (
              <Stack gap={4}>
                {visible.map((option) => (
                  <Checkbox
                    key={option}
                    size="xs"
                    label={option}
                    checked={ticked.includes(option)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setTicked((previous) =>
                        checked ? [...previous, option] : previous.filter((item) => item !== option),
                      )
                    }}
                  />
                ))}
              </Stack>
            )}
          </ScrollArea.Autosize>
        </>
      ) : null}

      <Divider />

      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Button size="compact-xs" variant="subtle" color="gray" onClick={clear} disabled={value === undefined}>
          Clear
        </Button>
        <Group gap={6} wrap="nowrap">
          <Button size="compact-xs" variant="default" onClick={close}>
            Cancel
          </Button>
          <Button size="compact-xs" onClick={apply}>
            OK
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
