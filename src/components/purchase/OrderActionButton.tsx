import type { ReactNode } from 'react'
import { Button, Tooltip, type ButtonProps } from '@mantine/core'
import type { OrderAbility } from './orderAbilities'

interface OrderActionButtonProps extends Omit<ButtonProps, 'children'> {
  ability: OrderAbility
  onClick: () => void
  children: ReactNode
  /** What the button does, said on hover while it can be pressed. */
  hint?: string
}

/**
 * One order action as `orderAbilities` judged it: hidden without the permission, disabled with the
 * reason as its tooltip when the order is not in a state to take it, a plain button otherwise.
 */
export function OrderActionButton({ ability, onClick, children, hint, ...button }: OrderActionButtonProps) {
  if (!ability.visible) return null

  if (ability.blockedBy) {
    return (
      <Tooltip label={ability.blockedBy} withArrow multiline w={280}>
        {/* data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs. */}
        <Button {...button} data-disabled aria-disabled onClick={(event) => event.preventDefault()}>
          {children}
        </Button>
      </Tooltip>
    )
  }

  const pressable = (
    <Button {...button} onClick={onClick}>
      {children}
    </Button>
  )
  return hint ? (
    <Tooltip label={hint} withArrow multiline w={280}>
      {pressable}
    </Tooltip>
  ) : (
    pressable
  )
}
