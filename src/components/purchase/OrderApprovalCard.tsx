import type { ReactNode } from 'react'
import { Badge, Group, Paper, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core'
import { IconDeviceDesktop, IconHourglassHigh, IconMail } from '@tabler/icons-react'
import type { ApprovalApproverDto, ApprovalStateDto } from '../../api/purchase/approvals'
import { stamp } from '../documents/documentKind'

/** How an approver decides, said by the icons on their chip: an envelope by email, a screen in the app. */
function channels(approver: ApprovalApproverDto): string {
  if (approver.canApproveByEmail && approver.canApproveInApp) return 'By email and in the app'
  return approver.canApproveByEmail ? 'By email' : 'In the app'
}

function ApproverChip({ approver }: { approver: ApprovalApproverDto }) {
  return (
    <Tooltip label={channels(approver)} withArrow>
      <Badge
        variant="white"
        color="dark"
        size="lg"
        radius="xl"
        tt="none"
        fw={500}
        style={{ border: '1px solid var(--mantine-color-yellow-4)' }}
        leftSection={
          <Group gap={4} wrap="nowrap">
            {approver.canApproveByEmail && <IconMail size={14} aria-label="by email" />}
            {approver.canApproveInApp && <IconDeviceDesktop size={14} aria-label="in the app" />}
          </Group>
        }
        data-approver={approver.fullName}
      >
        {approver.fullName}
      </Badge>
    </Tooltip>
  )
}

interface OrderApprovalCardProps {
  state: ApprovalStateDto
  approvers: ApprovalApproverDto[]
  /** The buttons the reader may press here (Approve, Reject…, Send again, Withdraw) — decided by orderAbilities. */
  actions: ReactNode
}

/**
 * An order waiting for approval, at the top of its page: since when and by whom it was requested, who
 * can decide and how, how long the emailed links work and when the next reminder goes — and the
 * buttons of whoever is reading.
 */
export function OrderApprovalCard({ state, approvers, actions }: OrderApprovalCardProps) {
  return (
    <Paper
      radius="lg"
      p="md"
      withBorder
      bg="yellow.0"
      style={{ borderColor: 'var(--mantine-color-yellow-5)' }}
      data-approval-card
    >
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon color="yellow" variant="light" size="lg" radius="xl">
            <IconHourglassHigh size={20} />
          </ThemeIcon>
          <div>
            <Title order={5}>Approval</Title>
            <Text size="sm">
              Waiting for approval since {stamp(state.requestedAtUtc)}
              {state.requestedByName ? ` - requested by ${state.requestedByName}` : ''}
            </Text>
          </div>
        </Group>

        {approvers.length > 0 ? (
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Approvers:
            </Text>
            {approvers.map((approver) => (
              <ApproverChip key={approver.userId} approver={approver} />
            ))}
          </Group>
        ) : null}

        {(state.linksValidUntilUtc || state.nextReminderAtUtc) && (
          <Group gap="lg">
            {state.linksValidUntilUtc && (
              <Text size="sm" c="dimmed">
                Links valid until {stamp(state.linksValidUntilUtc)}
              </Text>
            )}
            {state.nextReminderAtUtc && (
              <Text size="sm" c="dimmed">
                Next reminder {stamp(state.nextReminderAtUtc)}
              </Text>
            )}
          </Group>
        )}

        {actions}
      </Stack>
    </Paper>
  )
}
