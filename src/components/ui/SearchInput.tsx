interface SearchInputProps {
  value: string
  onChange(value: string): void
  placeholder?: string
  label?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search...', label = 'Search' }: SearchInputProps) {
  return (
    <div className="search-input">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.6-3.6" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
