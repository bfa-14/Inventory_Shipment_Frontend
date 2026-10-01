import { useState } from 'react'
import { ActionIcon, Group, Menu, Select, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconFilter } from '@tabler/icons-react'
import { DateInput } from '@mantine/dates'
import { fromIsoDate, isoDate } from '../../documents/documentKind'
import { defaultOperator, isEmptyFilter, OPERATORS, parseNumberExpression, type ColumnKind, type FilterOp, type FilterValue } from './gridModel'

interface GridFilterCellProps {
  label: string
  kind: ColumnKind
  value: FilterValue | undefined
  options: string[]
  onChange(value: FilterValue | undefined): void
}

/**
 * The filter row's cell under one header: the quick way to filter, typed straight into the grid.
 *
 *   text      "Contains" as you type
 *   number    "100", ">100", ">=100", "<5", "<>5", or "1..5" for a range
 *   date      pick a day
 *   list      pick one value
 *
 * It and the header's filter dialog edit the SAME filter, so a condition set in one shows in the
 * other. A filter the cell cannot express (a "starts with", a ticked list) shows as a short
 * description instead of being silently overwritten; typing replaces only the half the cell owns.
 */
export function GridFilterCell({ label, kind, value, options, onChange }: GridFilterCellProps) {
  // Stops a click in the box from reaching the header, which would sort the column.
  const stop = { onClick: (event: { stopPropagation(): void }) => event.stopPropagation() }

  if (kind === 'list' || kind === 'boolean') {
    const picked = value?.values?.length === 1 ? value.values[0] : null
    return (
      <div {...stop}>
        <Select
          size="xs"
          aria-label={`Filter ${label}`}
          placeholder="All"
          data={options}
          value={picked}
          onChange={(next) => onChange(next ? { values: [next] } : undefined)}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
      </div>
    )
  }

  return <TypedBox label={label} kind={kind} value={value} onChange={onChange} stop={stop} />
}

/** The funnel button at the left of a filter-row box: pick the condition (contains, starts with, >, between …). */
function OperatorMenu({ kind, op, onPick }: { kind: ColumnKind; op: FilterOp; onPick(op: FilterOp): void }) {
  const choices = OPERATORS[kind]
  const current = choices.find((choice) => choice.op === op)
  return (
    <Menu withinPortal position="bottom-start" shadow="md" width={200}>
      <Menu.Target>
        <Tooltip label={current?.label ?? 'Condition'} withArrow>
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Filter condition">
            <IconFilter size={14} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {choices.map((choice) => (
          <Menu.Item
            key={choice.op}
            onClick={() => onPick(choice.op)}
            rightSection={choice.op === op ? <IconCheck size={14} /> : null}
          >
            {choice.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

/**
 * The text / number / date boxes. Each has a condition menu; what is typed is the operand. A number
 * box also still understands the shorthand (">=100", "1..5"). The chosen condition is kept here while
 * the box is empty, because an empty box is no filter and the filter itself would forget it.
 */
function TypedBox({
  label,
  kind,
  value,
  onChange,
  stop,
}: Pick<GridFilterCellProps, 'label' | 'kind' | 'value' | 'onChange'> & { stop: { onClick(event: { stopPropagation(): void }): void } }) {
  const isNumber = kind === 'number'
  const isDate = kind === 'date'
  const [pickedOp, setPickedOp] = useState<FilterOp>(defaultOperator(kind))
  const op: FilterOp = value?.op ?? pickedOp
  const needs = OPERATORS[kind].find((choice) => choice.op === op)?.needs ?? 1
  const twoOperands = needs === 2
  const rest = value?.values ? { values: value.values } : {}

  const owned = twoOperands ? (value?.b ?? '') : (value?.a ?? '')
  const [typed, setTyped] = useState(owned)
  const [focused, setFocused] = useState(false)
  const text = focused ? typed : owned

  function apply(next: FilterValue | undefined) {
    onChange(next && isEmptyFilter(next) && !next.values?.length ? undefined : next)
  }

  function pick(next: FilterOp) {
    setPickedOp(next)
    const stillNeeds = OPERATORS[kind].find((choice) => choice.op === next)?.needs ?? 1
    apply({ ...rest, op: next, a: stillNeeds === 0 ? undefined : value?.a, b: stillNeeds === 2 ? value?.b : undefined })
  }

  function commit(next: string) {
    setTyped(next)
    if (isNumber && !twoOperands) {
      const parsed = parseNumberExpression(next)
      if (parsed && /^\s*(>=|<=|<>|!=|>|<|=|.*\.\.)/.test(next)) {
        setPickedOp(parsed.op ?? op)
        apply({ ...rest, ...parsed })
        return
      }
    }
    apply({ ...rest, op, a: twoOperands ? value?.a : next, b: twoOperands ? next : undefined })
  }

  const noOperand = needs === 0
  const dayA = isDate && !twoOperands ? fromIsoDate(value?.a ?? null) : null
  const dayB = isDate && twoOperands ? fromIsoDate(value?.b ?? null) : null

  const menu = <OperatorMenu kind={kind} op={op} onPick={pick} />

  return (
    <div {...stop}>
      <Group gap={4} wrap="nowrap" align="center">
        {twoOperands ? (
          isDate ? (
            <DateInput
              size="xs"
              aria-label={`Filter ${label} from`}
              placeholder="From"
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(value?.a ?? null)}
              onChange={(next) => apply({ ...rest, op, a: next ? isoDate(new Date(next)) : undefined, b: value?.b })}
              clearable
              leftSection={menu}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <TextInput
              size="xs"
              aria-label={`Filter ${label} from`}
              placeholder="From"
              value={value?.a ?? ''}
              onChange={(event) => apply({ ...rest, op, a: event.currentTarget.value, b: value?.b })}
              leftSection={menu}
              inputMode="decimal"
              style={{ flex: 1, minWidth: 0 }}
            />
          )
        ) : null}
        {isDate ? (
          <DateInput
            size="xs"
            aria-label={`Filter ${label}${twoOperands ? ' to' : ''}`}
            placeholder={noOperand ? OPERATORS[kind].find((c) => c.op === op)?.label : twoOperands ? 'To' : 'Any day'}
            valueFormat="DD/MM/YYYY"
            value={twoOperands ? dayB : dayA}
            disabled={noOperand}
            onChange={(next) => {
              const iso = next ? isoDate(new Date(next)) : undefined
              apply(twoOperands ? { ...rest, op, a: value?.a, b: iso } : { ...rest, op, a: iso })
            }}
            clearable
            leftSection={twoOperands ? undefined : menu}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <TextInput
            size="xs"
            aria-label={`Filter ${label}${twoOperands ? ' to' : ''}`}
            placeholder={noOperand ? OPERATORS[kind].find((c) => c.op === op)?.label : twoOperands ? 'To' : isNumber ? '= > < …' : 'Contains…'}
            value={noOperand ? '' : text}
            disabled={noOperand}
            onChange={(event) => commit(event.currentTarget.value)}
            onFocus={() => {
              setTyped(owned)
              setFocused(true)
            }}
            onBlur={() => setFocused(false)}
            inputMode={isNumber ? 'decimal' : undefined}
            leftSection={twoOperands ? undefined : menu}
            style={{ flex: 1, minWidth: 0 }}
          />
        )}
      </Group>
    </div>
  )
}
