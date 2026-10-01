import { useState } from 'react'
import { Button, Checkbox, Divider, Group, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconSearch } from '@tabler/icons-react'
import { fromIsoDate, isoDate } from '../../documents/documentKind'
import {
  OPERATORS,
  conditionIsComplete,
  defaultOperator,
  isEmptyFilter,
  type ColumnKind,
  type FilterOp,
  type FilterValue,
} from './gridModel'

/** Above this many distinct values the tick list grows a search box of its own. */
const SEARCH_THRESHOLD = 10

export interface GridFilterPopoverProps {
  label: string
  kind: ColumnKind
  /** The filter in force on this column, or undefined when it is not filtering. */
  value: FilterValue | undefined
  /** The distinct values the column displays, for the tick list. */
  options: string[]
  onApply(value: FilterValue | undefined): void
  close(): void
}

/**
 * A column's filter dialog: a CONDITION typed by the reader (contains, greater than, between two
 * dates...) over a TICK LIST of the values the column shows - the two halves of a header filter in
 * a desktop grid, ANDed together.
 *
 * Nothing is applied until OK, so six ticks do not re-filter six times; the popover unmounts when it
 * closes, so the draft is seeded fresh on every open and a dismissed popover changes nothing.
 */
export function GridFilterPopover({ label, kind, value, options, onApply, close }: GridFilterPopoverProps) {
  const operators = OPERATORS[kind]
  const hasCondition = operators.length > 0

  const [op, setOp] = useState<FilterOp>(value?.op ?? defaultOperator(kind))
  const [a, setA] = useState(value?.a ?? '')
  const [b, setB] = useState(value?.b ?? '')
  // Seeded from what is in force, INTERSECTED with what still exists - a reload that drops a value
  // must not leave a tick nobody can see. Nothing in force means everything is ticked.
  const [ticked, setTicked] = useState<string[]>(() =>
    value?.values ? options.filter((option) => value.values?.includes(option)) : options,
  )
  const [search, setSearch] = useState('')

  const needs = operators.find((entry) => entry.op === op)?.needs ?? 0
  const needle = search.trim().toLowerCase()
  const visible = needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options
  const allTicked = options.length > 0 && ticked.length === options.length
  const someTicked = ticked.length > 0 && !allTicked

  function apply() {
    // Everything ticked and nothing ticked both mean "not narrowing by value": an accidental
    // untick-all-then-OK must not blank the grid.
    const values = options.length === 0 || allTicked || ticked.length === 0 ? undefined : ticked
    const next: FilterValue = { values }
    if (hasCondition) {
      const candidate: FilterValue = { op, a: needs >= 1 ? a : undefined, b: needs === 2 ? b : undefined }
      if (conditionIsComplete(candidate)) Object.assign(next, candidate)
    }
    onApply(isEmptyFilter(next) ? undefined : next)
    close()
  }

  function clear() {
    onApply(undefined)
    close()
  }

  /** One operand box, by the kind of column: a day picker for dates, a plain box for the rest. */
  const operand = (text: string, set: (next: string) => void, placeholder: string, autoFocus: boolean) =>
    kind === 'date' ? (
      <DateInput
        size="xs"
        valueFormat="DD/MM/YYYY"
        placeholder={placeholder}
        value={fromIsoDate(text || null)}
        onChange={(next) => set(next ? isoDate(new Date(next)) : '')}
        clearable
        aria-label={`${label} ${placeholder}`}
      />
    ) : (
      <TextInput
        size="xs"
        value={text}
        onChange={(event) => set(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply()
        }}
        placeholder={placeholder}
        inputMode={kind === 'number' ? 'decimal' : undefined}
        aria-label={`${label} ${placeholder}`}
        data-autofocus={autoFocus ? true : undefined}
      />
    )

  return (
    <Stack gap="xs" w={260}>
      {hasCondition ? (
        <>
          <Select
            size="xs"
            data={operators.map((entry) => ({ value: entry.op, label: entry.label }))}
            value={op}
            onChange={(next) => next && setOp(next as FilterOp)}
            allowDeselect={false}
            aria-label={`${label} condition`}
            comboboxProps={{ withinPortal: false }}
          />
          {needs >= 1 ? operand(a, setA, needs === 2 ? 'From' : 'Value', true) : null}
          {needs === 2 ? operand(b, setB, 'To', false) : null}
        </>
      ) : null}

      {options.length > 0 ? (
        <>
          {hasCondition ? <Divider /> : null}

          <Checkbox
            size="xs"
            label="Select all"
            checked={allTicked}
            indeterminate={someTicked}
            onChange={(event) => {
              // Read the event synchronously: React clears currentTarget before an updater runs.
              const checked = event.currentTarget.checked
              setTicked(checked ? options : [])
            }}
          />

          {options.length > SEARCH_THRESHOLD ? (
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
                      setTicked((previous) => (checked ? [...previous, option] : previous.filter((item) => item !== option)))
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
