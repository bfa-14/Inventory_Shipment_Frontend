import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router'
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconAlertTriangle, IconCheck, IconClockHour4, IconLock, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { publicApprovalApi, type PublicApprovalDto, type PublicDecisionResultDto } from '../../api/purchase/approvals'
import { katangaLogo } from '../../assets'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { formatMoney, formatNumber } from '../../components/format'

const COMPANY = 'Katanga TVS Motor Company'
const TOO_MANY = 'Too many attempts, try again in a minute.'

/** A link that can no longer decide (410 used / expired / withdrawn, 403 not this approver or self-approval). */
function isFinal(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 410 || error.status === 403)
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) return TOO_MANY
  return error instanceof ApiError ? error.message : fallback
}

/** The page's frame: the company, then one card — no menu, no sign-in. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <Box mih="100vh" bg="gray.0" py={{ base: 'md', sm: 40 }} px={{ base: 'sm', sm: 'md' }}>
      <Stack maw={760} mx="auto" gap="md">
        <Group gap="sm" justify="center">
          <Image src={katangaLogo} alt="" h={36} w="auto" fit="contain" />
          <Text fw={700} size="lg">
            {COMPANY}
          </Text>
        </Group>
        {children}
      </Stack>
    </Box>
  )
}

/** The end of the road: decided, or a link that cannot decide any more. Says what happened, and nothing to press. */
function OutcomeCard({ colour, icon, title, message }: { colour: string; icon: ReactNode; title: string; message?: string }) {
  return (
    <Card radius="lg" withBorder padding="xl" data-outcome={colour}>
      <Stack align="center" gap="sm" ta="center">
        <ThemeIcon size={56} radius="xl" color={colour} variant="light">
          {icon}
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        {message ? <Text>{message}</Text> : null}
        <Text c="dimmed" size="sm">
          You can close this page.
        </Text>
      </Stack>
    </Card>
  )
}

/**
 * The page an approver lands on from the link in their email, at /purchase-approval/:token.
 *
 * NO SIGN-IN: the token in the address is the approver's proof, and the server checks it on every call
 * (and stops answering after 30 calls a minute). Opening the page NEVER decides — the email's two
 * buttons only choose which of the page's buttons is ready: ?action=approve puts Approve forward and
 * focused, ?action=reject opens the reason. Only a click here sends the decision.
 *
 * A link that cannot decide any more — used, expired, withdrawn, another approver's order, or the
 * approver's own request with self-approval off — shows the server's sentence and no button.
 */
export function PublicPurchaseApprovalPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const action = searchParams.get('action')
  const phone = useMediaQuery('(max-width: 36em)')

  const [data, setData] = useState<PublicApprovalDto | null>(null)
  const [fatal, setFatal] = useState<{ final: boolean; message: string } | null>(null)
  const [rejecting, setRejecting] = useState(action === 'reject')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [result, setResult] = useState<PublicDecisionResultDto | null>(null)
  const approveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    publicApprovalApi
      .get(token, controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setFatal({ final: isFinal(error), message: messageOf(error, 'This page could not be loaded. Try again in a moment.') })
      })
    return () => controller.abort()
  }, [token])

  // ?action=approve: the Approve button is ready under the reader's finger — focused, never pressed.
  useEffect(() => {
    if (data && action === 'approve') approveRef.current?.focus()
  }, [data, action])

  async function decide(approve: boolean) {
    if (!approve && reason.trim().length === 0) {
      setReasonError('Say why the order is rejected.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      setResult(await publicApprovalApi.decide(token, approve, approve ? null : reason.trim()))
    } catch (error) {
      if (isFinal(error)) setFatal({ final: true, message: error.message })
      else setProblem(messageOf(error, 'The decision could not be sent. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const approved = result.status === 'Posted' || result.status === 'Closed'
    return (
      <Frame>
        {approved ? (
          <OutcomeCard colour="green" icon={<IconCheck size={30} />} title={`Approved: ${result.documentNumber ?? ''}`.trim()} message="The order is posted." />
        ) : (
          <OutcomeCard colour="red" icon={<IconX size={30} />} title="Rejected" message="The order goes back to its author with your reason." />
        )}
      </Frame>
    )
  }

  if (fatal) {
    return (
      <Frame>
        {fatal.final ? (
          <OutcomeCard colour="orange" icon={<IconLock size={30} />} title="This link can no longer be used" message={fatal.message} />
        ) : (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Not available" data-load-error>
            {fatal.message}
          </Alert>
        )}
      </Frame>
    )
  }

  if (!data) {
    return (
      <Frame>
        <Center py="xl">
          <Loader />
        </Center>
      </Frame>
    )
  }

  const { order, lines } = data
  const money = (value: number) => formatMoney(value, order.currencyCode, order.decimalPlaces)

  const summary: [string, ReactNode][] = [
    ['Supplier', order.supplierName],
    ['Order date', dateLabel(order.orderDate)],
    ['Currency', order.currencyCode],
    ['Total', <b key="total">{money(order.total)}</b>],
    ['Requested by', order.requestedByName ? `${order.requestedByName}${order.requestedAtUtc ? ` on ${stamp(order.requestedAtUtc)}` : ''}` : '—'],
    ...(order.notes ? ([['Notes', order.notes]] as [string, ReactNode][]) : []),
  ]

  return (
    <Frame>
      <Card radius="lg" withBorder padding={phone ? 'md' : 'xl'}>
        <Stack gap="md">
          <div>
            <Title order={2} size="h3">
              Purchase order for approval
            </Title>
            <Text c="dimmed" size="sm">
              {order.documentNumber ? `${order.documentNumber} · ` : ''}For {data.approverName}
            </Text>
          </div>

          <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing={0} data-summary>
            <Table.Tbody>
              {summary.map(([label, value]) => (
                <Table.Tr key={label}>
                  <Table.Td w={130} c="dimmed" fz="sm" style={{ verticalAlign: 'top' }}>
                    {label}
                  </Table.Td>
                  <Table.Td fz="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {value}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Divider label={`${formatNumber(order.lineCount)} line(s)`} labelPosition="left" />

          {phone ? (
            <Stack gap="xs" data-lines="compact">
              {lines.map((line) => (
                <Box key={line.lineNo} py={6} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                    <Text size="sm" fw={600} style={{ wordBreak: 'break-word' }}>
                      {line.itemCode}
                    </Text>
                    <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                      {money(line.lineTotal)}
                    </Text>
                  </Group>
                  <Text size="sm">{line.itemName}</Text>
                  <Text size="xs" c="dimmed">
                    {formatNumber(line.quantity)} {line.unitName} × {money(line.unitPrice)}
                  </Text>
                </Box>
              ))}
            </Stack>
          ) : (
            <Table striped withTableBorder verticalSpacing="xs" data-lines="table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>#</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th ta="right">Quantity</Table.Th>
                  <Table.Th ta="right">Unit price</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((line) => (
                  <Table.Tr key={line.lineNo}>
                    <Table.Td>{line.lineNo}</Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {line.itemCode}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {line.itemName}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                      {formatNumber(line.quantity)} {line.unitName}
                    </Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                      {money(line.unitPrice)}
                    </Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                      {money(line.lineTotal)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          <Group gap={6} c="dimmed">
            <IconClockHour4 size={16} />
            <Text size="sm">This link is valid until {stamp(data.linkExpiresAtUtc)}.</Text>
          </Group>

          {problem && (
            <Alert color="red" data-decision-problem>
              {problem}
            </Alert>
          )}

          {rejecting ? (
            <Stack gap="sm" data-reject-form>
              <Textarea
                label="Reason for the rejection"
                withAsterisk
                placeholder="Why is this order rejected? Its author will read it."
                value={reason}
                onChange={(event) => {
                  setReason(event.currentTarget.value)
                  setReasonError(null)
                }}
                error={reasonError}
                maxLength={300}
                autosize
                minRows={3}
                autoFocus
              />
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                <Button variant="default" size="md" fullWidth disabled={busy} onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button color="red" size="md" fullWidth loading={busy} onClick={() => void decide(false)}>
                  Reject the order
                </Button>
              </SimpleGrid>
            </Stack>
          ) : (
            <Stack gap="sm">
              {action === 'approve' && (
                <Text fw={500} data-about-to-approve>
                  You are about to approve this purchase order.
                </Text>
              )}
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                <Button
                  ref={approveRef}
                  color="green"
                  size="md"
                  fullWidth
                  leftSection={<IconCheck size={18} />}
                  loading={busy}
                  onClick={() => void decide(true)}
                  data-approve
                >
                  Approve
                </Button>
                <Button
                  color="red"
                  variant={action === 'approve' ? 'outline' : 'light'}
                  size="md"
                  fullWidth
                  leftSection={<IconX size={18} />}
                  disabled={busy}
                  onClick={() => setRejecting(true)}
                  data-reject
                >
                  Reject...
                </Button>
              </SimpleGrid>
            </Stack>
          )}
        </Stack>
      </Card>
    </Frame>
  )
}
