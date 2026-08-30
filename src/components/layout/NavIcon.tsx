import type { ReactElement } from 'react'

interface NavIconProps {
  name: string
}

/** Inline icon set for the sidebar (no icon package needed). */
export function NavIcon({ name }: NavIconProps) {
  const paths: Record<string, ReactElement> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    box: (
      <>
        <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z" strokeLinejoin="round" />
        <path d="M4 7.2 12 11.5l8-4.3M12 11.5V21" strokeLinejoin="round" />
      </>
    ),
    clipboard: (
      <>
        <rect x="5" y="4.5" width="14" height="16" rx="2.2" />
        <path d="M9 4.5V3.4h6v1.1" strokeLinejoin="round" />
        <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" strokeLinecap="round" />
      </>
    ),
    cart: (
      <>
        <path d="M3 4h2.2l2 10.5h9.3l2-7.5H6.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="19" r="1.6" />
        <circle cx="17" cy="19" r="1.6" />
      </>
    ),
    invoice: (
      <>
        <path d="M6 3h9l3.5 3.5V21l-2.2-1.3-2.2 1.3-2.2-1.3L9.7 21l-2.2-1.3L6 21z" strokeLinejoin="round" />
        <path d="M9.3 9h6M9.3 12.5h6M9.3 16h3.5" strokeLinecap="round" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" strokeLinejoin="round" />
        <circle cx="7" cy="18" r="1.8" />
        <circle cx="17.5" cy="18" r="1.8" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.4" />
        <path d="M3 10h18" strokeLinecap="round" />
        <circle cx="16.5" cy="14.5" r="1.3" />
      </>
    ),
    documents: (
      <>
        <path d="M8 3h6l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
        <path d="M14 3v4h4" strokeLinejoin="round" />
        <path d="M9.5 13h5M9.5 16.5h5" strokeLinecap="round" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V4M4 20h16" strokeLinecap="round" />
        <path d="M8 17V11M12.5 17V7.5M17 17v-4" strokeLinecap="round" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="6" rx="7.5" ry="3" />
        <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" strokeLinecap="round" />
        <path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" strokeLinecap="round" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19.5c0-3.1 2.6-5 5.5-5s5.5 1.9 5.5 5" strokeLinecap="round" />
        <path d="M16 11.2a3 3 0 1 0 0-6M17.5 19.5c0-2.2-.9-3.8-2.3-4.6" strokeLinecap="round" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3.1" />
        <path
          d="M19.4 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9z"
          strokeLinejoin="round"
        />
      </>
    ),
    plug: (
      <>
        <path d="M9 3v5M15 3v5" strokeLinecap="round" />
        <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" strokeLinejoin="round" />
        <path d="M12 16.5V21" strokeLinecap="round" />
      </>
    ),
    history: (
      <>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" strokeLinecap="round" />
        <path d="M3.5 4.5V10H9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  }

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {paths[name] ?? paths.grid}
    </svg>
  )
}
