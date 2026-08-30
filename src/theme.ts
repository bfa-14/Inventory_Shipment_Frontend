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

/** Content background from the customer figures. */
export const CONTENT_BG = '#F5F7FB'

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
