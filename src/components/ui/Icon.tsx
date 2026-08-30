import type { ReactElement } from 'react'

export type IconName =
  | 'search'
  | 'bell'
  | 'plus'
  | 'more'
  | 'refresh'
  | 'download'
  | 'filter'
  | 'pencil'
  | 'trash'
  | 'power'
  | 'star'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'sort'
  | 'sort-asc'
  | 'sort-desc'
  | 'menu'

interface IconProps {
  name: IconName
  /** Extra class on the <svg>, e.g. for colour or size. */
  className?: string
  /** Filled shapes (used for the amber Main Branch star). */
  filled?: boolean
}

const PATHS: Record<IconName, ReactElement> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" strokeLinecap="round" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5.2-1.7 6.5-1.7 6.5h15.4S18 13.7 18 8.5" strokeLinejoin="round" />
      <path d="M13.7 18.5a2 2 0 0 1-3.4 0" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="18.5" r="1.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-.9 4.7" strokeLinecap="round" />
      <path d="M20 4.5V11h-6.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" strokeLinecap="round" />
      <path d="m8 11 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 19.5h15" strokeLinecap="round" />
    </>
  ),
  filter: (
    <>
      <path d="M3.5 5.5h17l-6.6 7.6v5.6l-3.8 2v-7.6z" strokeLinejoin="round" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z" strokeLinejoin="round" />
      <path d="m13.8 6 4.2 4.2" strokeLinecap="round" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" strokeLinecap="round" />
      <path d="M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7" strokeLinejoin="round" />
      <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" strokeLinejoin="round" />
      <path d="M10.3 10v6.7M13.7 10v6.7" strokeLinecap="round" />
    </>
  ),
  power: (
    <>
      <path d="M12 3.5v8" strokeLinecap="round" />
      <path d="M7.3 6.6a7.5 7.5 0 1 0 9.4 0" strokeLinecap="round" />
    </>
  ),
  star: <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" strokeLinejoin="round" />,
  'chevron-down': <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />,
  'chevron-left': <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />,
  'chevron-right': <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />,
  sort: <path d="m8 10 4-4 4 4M8 14l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />,
  'sort-asc': <path d="m7 14 5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />,
  'sort-desc': <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />,
}

/** Inline icon set for buttons and table cells, sized by CSS. */
export function Icon({ name, className, filled = false }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
