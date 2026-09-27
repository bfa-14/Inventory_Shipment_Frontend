import { IconAnchor, IconBox, IconFlag, IconShieldCheck, IconShip, IconTruck } from '@tabler/icons-react'

/**
 * How a movement stage is drawn wherever a leg of the route is shown: the movements list, the
 * movement page, the container's route timeline. One table, so a sea leg is the same blue ship on
 * every screen.
 */
const STAGE_COLOURS: Record<string, string> = {
  Origin: 'gray',
  Sea: 'blue',
  Transit: 'indigo',
  Port: 'orange',
  Border: 'grape',
  Customs: 'teal',
  Delivery: 'green',
}

// A shared helper beside its component on purpose: every caller needs both, and splitting them
// would only give the colour a second home to drift from.
// oxlint-disable-next-line react/only-export-components
export function stageColour(stage: string): string {
  return STAGE_COLOURS[stage] ?? 'gray'
}

/**
 * The stage's icon in the stage's colour. `color` overrides it where the icon sits on a coloured
 * ground - a timeline bullet passes "currentColor" to take the bullet's own text colour.
 */
export function StageIcon({ stage, size = 16, color }: { stage: string; size?: number; color?: string }) {
  const colour = color ?? `var(--mantine-color-${stageColour(stage)}-6)`
  switch (stage) {
    case 'Sea':
      return <IconShip size={size} color={colour} aria-hidden />
    case 'Port':
      return <IconAnchor size={size} color={colour} aria-hidden />
    case 'Transit':
    case 'Delivery':
      return <IconTruck size={size} color={colour} aria-hidden />
    case 'Customs':
      return <IconShieldCheck size={size} color={colour} aria-hidden />
    case 'Border':
      return <IconFlag size={size} color={colour} aria-hidden />
    default:
      return <IconBox size={size} color={colour} aria-hidden />
  }
}
