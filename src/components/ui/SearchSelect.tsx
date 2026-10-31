import { useEffect, useMemo, useState } from 'react'
import { Loader, MultiSelect, Select, type MultiSelectProps, type OptionsFilter, type SelectProps } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'

/** One option of a server-searched dropdown. */
export interface SearchOption {
  value: string
  label: string
}

/** What is typed, as the server is asked for it: the first page when nothing is typed. */
export type SearchOptionsLoader = (search: string, signal: AbortSignal) => Promise<SearchOption[]>

const DEBOUNCE_MS = 300

/**
 * The options the server answers for what is typed, debounced, the abandoned requests aborted. `pinned` options (the
 * current value, a default) always stay in the list, first, so the field shows its label even when the search that
 * found it has moved on - or when it was never searched for (a default given by the server).
 */
function useSearchOptions(load: SearchOptionsLoader, search: string, pinned: SearchOption[]) {
  const [debounced] = useDebouncedValue(search.trim(), DEBOUNCE_MS)
  /** The last answer and what it answers: loading is "the answer is for another search". */
  const [answer, setAnswer] = useState<{ term: string; load: SearchOptionsLoader; options: SearchOption[] } | null>(
    null,
  )

  useEffect(() => {
    const controller = new AbortController()
    load(debounced, controller.signal)
      .then((options) => {
        if (!controller.signal.aborted) setAnswer({ term: debounced, load, options })
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer({ term: debounced, load, options: [] })
      })
    return () => controller.abort()
  }, [load, debounced])

  const current = answer !== null && answer.term === debounced && answer.load === load ? answer : null
  const data = useMemo(() => {
    const seen = new Set<string>()
    const out: SearchOption[] = []
    for (const option of [...pinned, ...(current?.options ?? answer?.options ?? [])]) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      out.push(option)
    }
    return out
  }, [pinned, current, answer])

  return { data, loading: current === null }
}

/** The server already filtered: the dropdown shows what it answered, whatever the label. */
const keepAll: OptionsFilter = ({ options }) => options

type SingleProps = Omit<
  SelectProps,
  'data' | 'value' | 'onChange' | 'searchable' | 'searchValue' | 'onSearchChange' | 'filter'
> & {
  value: string | null
  onChange(value: string | null, option: SearchOption | null): void
  /** Asked again as the reader types (debounced); a stable function (module level or useCallback). */
  load: SearchOptionsLoader
  /** The current value's option when it is known without a search (a default, a preset): shown at once. */
  selected?: SearchOption | null
  /**
   * The option of a value that came from elsewhere - a filter kept from the last visit - so the field shows its label
   * rather than staying blank while it filters.
   */
  resolve?(value: string): Promise<SearchOption | null>
}

/**
 * A DROPDOWN THAT SEARCHES THE SERVER AS IT IS TYPED, for the lists that grow without a ceiling - containers, orders,
 * invoices, movements, parties. A preloaded page (the 200 newest, the first 50 parties) hid everything after it, and
 * typing could only filter what had been loaded (script 78: any number of containers).
 */
export function SearchSelect({
  value,
  onChange,
  load,
  selected = null,
  resolve,
  nothingFoundMessage,
  ...rest
}: SingleProps) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<SearchOption | null>(null)
  const [resolved, setResolved] = useState<SearchOption | null>(null)

  // The label of the value: picked here, given by the caller, or asked for.
  const current =
    [picked, selected, resolved].find((option): option is SearchOption => option !== null && option.value === value) ??
    null
  const unknown = value !== null && current === null ? value : null
  useEffect(() => {
    if (unknown === null || !resolve) return
    let live = true
    resolve(unknown)
      .then((option) => {
        if (live && option) setResolved(option)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [unknown, resolve])

  // Once picked, the search box holds the label: ask for the first page then, not for that label.
  const term = current && search === current.label ? '' : search
  const pinned = useMemo(() => (current ? [current] : []), [current])
  const { data, loading } = useSearchOptions(load, term, pinned)

  return (
    <Select
      // Clicking the chosen option again would clear it (Mantine's default): clearing is the clear button's job.
      allowDeselect={false}
      {...rest}
      searchable
      data={data}
      value={value}
      filter={keepAll}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(next) => {
        const option = data.find((o) => o.value === next) ?? null
        setPicked(option)
        onChange(next, option)
      }}
      rightSection={loading ? <Loader size={14} /> : undefined}
      nothingFoundMessage={loading ? 'Searching…' : (nothingFoundMessage ?? 'Nothing matches')}
    />
  )
}

type MultiProps = Omit<
  MultiSelectProps,
  'data' | 'value' | 'onChange' | 'searchable' | 'searchValue' | 'onSearchChange' | 'filter'
> & {
  value: string[]
  onChange(value: string[]): void
  load: SearchOptionsLoader
  /** The options of the values chosen so far (presets included): they stay in the list whatever is typed. */
  selected: SearchOption[]
}

/** The several-values form of {@link SearchSelect}. */
export function SearchMultiSelect({ value, onChange, load, selected, nothingFoundMessage, ...rest }: MultiProps) {
  const [search, setSearch] = useState('')
  const { data, loading } = useSearchOptions(load, search, selected)

  return (
    <MultiSelect
      {...rest}
      searchable
      data={data}
      value={value}
      filter={keepAll}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={onChange}
      rightSection={loading ? <Loader size={14} /> : undefined}
      nothingFoundMessage={loading ? 'Searching…' : (nothingFoundMessage ?? 'Nothing matches')}
    />
  )
}
