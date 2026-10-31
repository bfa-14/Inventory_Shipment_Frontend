import type { ReactNode } from 'react'
import { Button, Group, Stack, Text, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconArrowBarToUp, IconPlaylistAdd } from '@tabler/icons-react'
import type { TransferAbility } from './transferAbilities'

interface TransferLinesToolbarProps {
  /** "Add items below Min…" (transferAbilities: a draft, the create permission; disabled with its reason). */
  addBelowMin: TransferAbility
  /** "Fill to Max…". */
  fillToMax: TransferAbility
  onAddBelowMin(): void
  onFillToMax(): void
  /** The page is saving or posting: both wait. */
  busy: boolean
}

/**
 * (91) THE LINES CARD'S TOOLBAR on a draft (3.6.5, as ShortageDocumentPage's "Load items"): "Add items below Min…" and
 * "Fill to Max…". A button the rule disables stays on screen and says why - "Save your changes first." while the page
 * holds changes (the server fills the SAVED lines), else the server's own sentence (no line, no level at To…): on hover
 * on a wide screen, as a dimmed line under the buttons on a phone, which shows no tooltip.
 */
export function TransferLinesToolbar({ addBelowMin, fillToMax, onAddBelowMin, onFillToMax, busy }: TransferLinesToolbarProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  if (!addBelowMin.visible && !fillToMax.visible) return null

  const button = (
    ability: TransferAbility,
    label: string,
    icon: ReactNode,
    onClick: () => void,
    marker: string,
    filled: boolean,
  ) => {
    if (!ability.visible) return null
    const blocked = ability.blockedBy !== null
    const control = (
      <Button
        variant={filled ? 'light' : 'default'}
        leftSection={icon}
        // data-disabled rather than disabled: a disabled button swallows the hover its tooltip needs.
        {...(blocked || busy ? { 'data-disabled': true, 'aria-disabled': true } : {})}
        onClick={(event) => (blocked || busy ? event.preventDefault() : onClick())}
        {...{ [marker]: true }}
        fullWidth={phone}
      >
        {label}
      </Button>
    )
    return blocked && !phone ? (
      <Tooltip label={ability.blockedBy} withArrow multiline w={280}>
        {control}
      </Tooltip>
    ) : (
      control
    )
  }

  /* A phone shows no tooltip: each reason under the buttons, once (both buttons usually give the same one). */
  const reasons = phone
    ? [...new Set([addBelowMin, fillToMax].filter((a) => a.visible && a.blockedBy).map((a) => a.blockedBy as string))]
    : []

  const buttons = (
    <>
      {button(
        addBelowMin,
        'Add items below Min…',
        <IconPlaylistAdd size={16} />,
        onAddBelowMin,
        'data-transfer-add-below-min',
        false,
      )}
      {button(fillToMax, 'Fill to Max…', <IconArrowBarToUp size={16} />, onFillToMax, 'data-transfer-fill-to-max', true)}
    </>
  )

  return (
    <Stack gap={4} w={phone ? '100%' : undefined}>
      {/* A phone stacks them, full width: side by side each label was cut ("Add items be…"). */}
      {phone ? (
        <Stack gap="xs">{buttons}</Stack>
      ) : (
        <Group gap="xs" wrap="nowrap">
          {buttons}
        </Group>
      )}
      {reasons.map((reason) => (
        <Text key={reason} fz="xs" c="dimmed">
          {reason}
        </Text>
      ))}
    </Stack>
  )
}
