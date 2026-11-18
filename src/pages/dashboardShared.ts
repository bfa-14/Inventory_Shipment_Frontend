import { formatDateOnly, formatNumber } from '../components/format'

/** The board's palette for the charts, in the order slices take them. */
export const CHART = {
  violet: '#b26cf2',
  pink: '#e15ad8',
  cyan: '#33d6d0',
  blue: '#3d7ff0',
  orange: '#ffb547',
  red: '#ff6b8a',
  green: '#3ddc97',
  grid: 'var(--mantine-color-gray-2)',
  text: 'var(--mantine-color-dimmed)',
  slices: ['#33d6d0', '#3d7ff0', '#b26cf2', '#e15ad8', '#ffb547', '#adb5bd'],
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The API's dates may carry a midnight time; the page shows the calendar date. */
export const showDate = (value: string | null | undefined) => formatDateOnly(value?.slice(0, 10))

/** "85.7k", "1.2M": the axes and donut centres have no room for every digit. */
export function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)}M`
  if (abs >= 1_000) return `${formatNumber(value / 1_000, 1)}k`
  return formatNumber(value, 0)
}
