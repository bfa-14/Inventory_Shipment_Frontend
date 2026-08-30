import { createTheme, type MantineColorsTuple } from '@mantine/core'

/** Ten shades around the reference primary #2563EB; shade 6 is the primary. */
const brand: MantineColorsTuple = [
  '#EEF3FF',
  '#DCE6FF',
  '#B9CCFF',
  '#93AEFF',
  '#6E8FFF',
  '#4F74F5',
  '#2563EB',
  '#1D4FD0',
  '#1741AD',
  '#12358C',
]

/**
 * The sign-in screen's palette, lifted from the `--katanga-*` custom properties in index.css so the
 * shell is painted in the colours the user just came through the door on. Kept here rather than read
 * from CSS because the shell sets some of them as inline styles, which cannot see a CSS variable
 * declared later in the cascade.
 */
export const KATANGA = {
  /** --katanga-navy: the sign-in button, and this app's strongest brand blue. */
  navy: '#013596',
  /** --katanga-page-bg: the deep field the sign-in card floats on. The sidebar's ground. */
  navyDeep: '#01235a',
  /** --katanga-page-glow: the lighter bloom behind that card, reused for the sidebar's gradient. */
  navyGlow: '#0a2e6e',
  /** --katanga-title: the near-black used for headings on white. */
  ink: '#101f43',
} as const

/**
 * The content background. A tint of the sign-in navy rather than the near-white it was, so cards and
 * grids read as white panels ON something instead of as slightly different whites.
 */
export const CONTENT_BG = '#EDF1F9'

export const theme = createTheme({
  colors: { brand },
  primaryColor: 'brand',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: '"Segoe UI", Inter, system-ui, sans-serif',
  headings: { fontWeight: '700' },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    TextInput: { defaultProps: { radius: 'md' } },
    Textarea: { defaultProps: { radius: 'md' } },
    Select: { defaultProps: { radius: 'md' } },
    NumberInput: { defaultProps: { radius: 'md' } },
    PasswordInput: { defaultProps: { radius: 'md' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 2 } } },
    Badge: { defaultProps: { radius: 'xl' }, styles: { root: { textTransform: 'none' } } },
    Table: { defaultProps: { highlightOnHover: true } },
  },
})
