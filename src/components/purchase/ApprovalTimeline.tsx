import type { ReactNode } from 'react'
import { Text, ThemeIcon, Timeline } from '@mantine/core'
import {
  IconArrowBackUp,
  IconBell,
  IconCheck,
  IconMail,
  IconMailOff,
  IconSend,
  IconCircleCheck,
  IconX,
} from '@tabler/icons-react'
import type { ApprovalEventDto } from '../../api/purchase/approvals'
import { stamp } from '../documents/documentKind'

/**
 * The procedure's event types (usp_PurchaseOrder_ApprovalHistory), each with its colour and icon: the
 * requests blue, a reminder grey, the approval green, a rejection red, a withdrawal orange, a posting
 * that needed no approval teal, the supplier email indigo — and orange again when it could not go.
 */
const EVENTS: Record<number, { colour: string; icon: ReactNode }> = {
  1: { colour: 'blue', icon: <IconSend size={13} /> },
  2: { colour: 'gray', icon: <IconBell size={13} /> },
  3: { colour: 'blue', icon: <IconSend size={13} /> },
  4: { colour: 'green', icon: <IconCheck size={13} /> },
  5: { colour: 'red', icon: <IconX size={13} /> },
  6: { colour: 'orange', icon: <IconArrowBackUp size={13} /> },
  7: { colour: 'teal', icon: <IconCircleCheck size={13} /> },
  8: { colour: 'indigo', icon: <IconMail size={13} /> },
  9: { colour: 'orange', icon: <IconMailOff size={13} /> },
}

/** What the event says beyond its name: to whom, how, why. */
function details(event: ApprovalEventDto): string[] {
  const lines: string[] = []
  switch (event.eventType) {
    case 1:
    case 2:
    case 3:
      if (event.recipients) lines.push(`To ${event.recipients}`)
      break
    case 4:
      lines.push([event.channelName, event.userName ? `by ${event.userName}` : null].filter(Boolean).join(', '))
      break
    case 5:
      if (event.channelName || event.userName) lines.push([event.channelName, event.userName ? `by ${event.userName}` : null].filter(Boolean).join(', '))
      if (event.reason) lines.push(`Reason: ${event.reason}`)
      break
    case 8:
      if (event.recipients) lines.push(`To ${event.recipients}`)
      break
    default:
      if (event.reason) lines.push(`Reason: ${event.reason}`)
  }
  if (event.note) lines.push(event.note)
  return lines.filter((line) => line.length > 0)
}

/**
 * The approval story of one order, oldest first — every request, reminder, decision and supplier
 * email, with who and when. It answers "who approved this, and how" without opening the email log.
 */
export function ApprovalTimeline({ events }: { events: ApprovalEventDto[] }) {
  if (events.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No approval event yet.
      </Text>
    )
  }

  return (
    // Every item "active": each segment takes its own event's colour instead of the default grey.
    <Timeline bulletSize={24} lineWidth={2} active={events.length - 1} data-approval-timeline>
      {events.map((event) => {
        const look = EVENTS[event.eventType] ?? { colour: 'gray', icon: null }
        // Who, for the events whose details do not already say "by …": the requests, withdrawals, postings.
        const by = event.eventType !== 4 && event.eventType !== 5 && event.userName ? ` · ${event.userName}` : ''
        return (
          <Timeline.Item
            key={event.id}
            color={look.colour}
            title={
              <Text size="sm" fw={600} c={`${look.colour}.8`}>
                {event.eventName}
              </Text>
            }
            bullet={
              <ThemeIcon size={24} radius="xl" color={look.colour}>
                {look.icon}
              </ThemeIcon>
            }
            data-event-type={event.eventType}
          >
            {details(event).map((line) => (
              <Text key={line} size="sm">
                {line}
              </Text>
            ))}
            <Text size="xs" c="dimmed" mt={2}>
              {stamp(event.atUtc)}
              {by}
            </Text>
          </Timeline.Item>
        )
      })}
    </Timeline>
  )
}
