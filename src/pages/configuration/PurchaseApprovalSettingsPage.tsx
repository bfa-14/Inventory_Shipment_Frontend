import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMediaQuery } from '@mantine/hooks'
import { IconDeviceFloppy, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  approvalSettingsApi,
  type ApprovalSettingsDto,
  type ApproverRights,
  type SaveApprovalSettingsRequest,
} from '../../api/purchase/approvals'
import { formatDateTime } from '../../components/format'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'

const CONFLICT_MESSAGE = 'Someone else changed these settings. Reload the page.'

interface RulesForm {
  requireApproval: boolean
  approvalLimitBase: number | string
  allowSelfApproval: boolean
  linkValidHours: number | string
  reminderHours: number | string
  notifyAppApprovers: boolean
  emailSupplierOnApproval: boolean
  copyToOwners: boolean
  copyToEmails: string
}

type Rights = Record<number, { app: boolean; email: boolean }>

function toForm(data: ApprovalSettingsDto): RulesForm {
  const s = data.settings
  return {
    requireApproval: s.requireApproval,
    approvalLimitBase: s.approvalLimitBase,
    allowSelfApproval: s.allowSelfApproval,
    linkValidHours: s.linkValidHours,
    reminderHours: s.reminderHours,
    notifyAppApprovers: s.notifyAppApprovers,
    emailSupplierOnApproval: s.emailSupplierOnApproval,
    copyToOwners: s.copyToOwners,
    copyToEmails: s.copyToEmails ?? '',
  }
}

function toRights(data: ApprovalSettingsDto): Rights {
  return Object.fromEntries(data.users.map((u) => [u.userId, { app: u.canApproveInApp, email: u.canApproveByEmail }]))
}

function sameRights(a: Rights, b: Rights): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const x = a[Number(key)]
    const y = b[Number(key)]
    if ((x?.app ?? false) !== (y?.app ?? false) || (x?.email ?? false) !== (y?.email ?? false)) return false
  }
  return true
}

/**
 * Settings > Purchase approval: whether purchase orders need approval before they are posted, and who
 * approves them - in the application, by a personal link in an email, or both.
 *
 * THE APPROVERS ARE TICKED HERE, NOT GIVEN BY A ROLE: the server reads this list and nothing else. A user
 * without an email address can only approve in the application.
 */
export function PurchaseApprovalSettingsPage() {
  const [data, setData] = useState<ApprovalSettingsDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [rights, setRights] = useState<Rights>({})
  const [baseline, setBaseline] = useState<Rights>({})
  const [search, setSearch] = useState('')
  // A phone gets one compact row per user instead of the table: the two checkboxes stay in view.
  const narrow = useMediaQuery('(max-width: 48em)')

  const form = useForm<RulesForm>({
    mode: 'controlled',
    initialValues: {
      requireApproval: true,
      approvalLimitBase: 0,
      allowSelfApproval: true,
      linkValidHours: 72,
      reminderHours: 24,
      notifyAppApprovers: true,
      emailSupplierOnApproval: true,
      copyToOwners: true,
      copyToEmails: '',
    },
    validate: {
      approvalLimitBase: (value) => (Number(value) >= 0 ? null : 'The approval limit cannot be negative.'),
      linkValidHours: (value) => {
        const hours = Number(value)
        return Number.isInteger(hours) && hours >= 1 && hours <= 720 ? null : 'Between 1 and 720 hours.'
      },
      reminderHours: (value) => {
        const hours = Number(value)
        return Number.isInteger(hours) && hours >= 0 && hours <= 168 ? null : 'Between 0 (never) and 168 hours.'
      },
    },
  })

  const apply = useCallback(
    (next: ApprovalSettingsDto) => {
      setData(next)
      form.setValues(toForm(next))
      form.resetDirty(toForm(next))
      setRights(toRights(next))
      setBaseline(toRights(next))
    },
    // form is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setConflict(false)
    try {
      apply(await approvalSettingsApi.get())
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'The purchase approval settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const dirty = form.isDirty() || !sameRights(rights, baseline)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const users = useMemo(() => data?.users ?? [], [data])
  const shownUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((u) =>
      [u.fullName, u.userName, u.roles ?? '', u.email ?? ''].some((text) => text.toLowerCase().includes(term)),
    )
  }, [users, search])

  const counts = useMemo(() => {
    let approvers = 0
    let inApp = 0
    let byEmail = 0
    for (const user of users) {
      const r = rights[user.userId]
      if (!r) continue
      if (r.app || r.email) approvers++
      if (r.app) inApp++
      if (r.email) byEmail++
    }
    return { approvers, inApp, byEmail }
  }, [users, rights])

  function setRight(userId: number, key: 'app' | 'email', value: boolean) {
    setRights((current) => ({
      ...current,
      [userId]: { ...(current[userId] ?? { app: false, email: false }), [key]: value },
    }))
  }

  async function save(values: RulesForm) {
    if (!data) return
    setSaving(true)
    const approvers: ApproverRights[] = users.map((u) => ({
      userId: u.userId,
      canApproveInApp: rights[u.userId]?.app ?? false,
      canApproveByEmail: rights[u.userId]?.email ?? false,
    }))
    const payload: SaveApprovalSettingsRequest = {
      requireApproval: values.requireApproval,
      approvalLimitBase: Number(values.approvalLimitBase) || 0,
      allowSelfApproval: values.allowSelfApproval,
      linkValidHours: Number(values.linkValidHours),
      reminderHours: Number(values.reminderHours),
      notifyAppApprovers: values.notifyAppApprovers,
      emailSupplierOnApproval: values.emailSupplierOnApproval,
      copyToOwners: values.copyToOwners,
      copyToEmails: values.copyToEmails.trim() === '' ? null : values.copyToEmails.trim(),
      approvers,
      rowVersion: data.settings.rowVersion,
    }
    try {
      apply(await approvalSettingsApi.save(payload))
      notify.success('Purchase approval settings saved.')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true)
        notify.error(CONFLICT_MESSAGE)
      } else {
        notify.error(error instanceof ApiError ? error.message : 'The purchase approval settings could not be saved.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="Purchase approval"
          subtitle="Whether purchase orders need approval, and who approves them."
        />
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Purchase approval" />
        <Alert color="red" title="Could not load the purchase approval settings">
          {loadError}
        </Alert>
      </>
    )
  }

  const values = form.getValues()
  const off = !values.requireApproval
  const currency = data.settings.baseCurrencyCode ?? ''

  return (
    <form onSubmit={form.onSubmit((v) => void save(v))} noValidate>
      <PageHeader title="Purchase approval" subtitle="Whether purchase orders need approval, and who approves them." />

      {conflict ? (
        <Alert color="red" mb="md" title="These settings were changed meanwhile">
          <Group justify="space-between" gap="sm">
            <Text fz="sm">{CONFLICT_MESSAGE}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => void load()}>
              Reload
            </Button>
          </Group>
        </Alert>
      ) : null}

      <Stack gap="lg">
        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            Rules
          </Title>
          <Stack gap="md">
            <Switch
              size="md"
              label="Purchase orders need approval before they are posted"
              {...form.getInputProps('requireApproval', { type: 'checkbox' })}
            />
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <NumberInput
                  label="Orders up to this amount are posted without approval"
                  description="0 = every order needs approval"
                  min={0}
                  thousandSeparator=","
                  decimalScale={2}
                  suffix={currency ? ` ${currency}` : undefined}
                  disabled={off}
                  {...form.getInputProps('approvalLimitBase')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <NumberInput
                  label="Approval links are valid for"
                  min={1}
                  max={720}
                  allowDecimal={false}
                  suffix=" hours"
                  disabled={off}
                  {...form.getInputProps('linkValidHours')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <NumberInput
                  label="Remind the approvers every"
                  description="0 = never"
                  min={0}
                  max={168}
                  allowDecimal={false}
                  suffix=" hours"
                  disabled={off}
                  {...form.getInputProps('reminderHours')}
                />
              </Grid.Col>
            </Grid>
            <Switch
              label="The person who sends an order may approve it"
              disabled={off}
              {...form.getInputProps('allowSelfApproval', { type: 'checkbox' })}
            />
            <Switch
              label="Tell the in-app approvers by email (with a link to the order)"
              disabled={off}
              {...form.getInputProps('notifyAppApprovers', { type: 'checkbox' })}
            />
          </Stack>
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            After approval
          </Title>
          <Stack gap="md">
            <div>
              <Switch
                label="Email the approved order to the supplier"
                {...form.getInputProps('emailSupplierOnApproval', { type: 'checkbox' })}
              />
              <Text fz="xs" c="dimmed" mt={4} ml={54}>
                An order whose supplier has no email address cannot be sent for approval while this is on.
              </Text>
            </div>
            <Switch
              label="Send a copy to the Owner role"
              {...form.getInputProps('copyToOwners', { type: 'checkbox' })}
            />
            <TextInput
              label="Also send a copy to"
              placeholder="accounts@example.com; director@example.com"
              description="Addresses separated by ;"
              {...form.getInputProps('copyToEmails')}
            />
          </Stack>
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap" gap="sm">
            <div>
              <Title order={4}>Approvers</Title>
              <Text fz="sm" c="dimmed">
                {counts.approvers} approver{counts.approvers === 1 ? '' : 's'}: {counts.inApp} in the app,{' '}
                {counts.byEmail} by email
              </Text>
            </div>
            <TextInput
              aria-label="Search the users"
              placeholder="Search by name, role or email"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              w={{ base: '100%', sm: 300 }}
            />
          </Group>

          {values.requireApproval && counts.approvers === 0 ? (
            <Alert color="red" mb="sm">
              Nobody can approve purchase orders.
            </Alert>
          ) : null}

          {narrow ? (
            <Stack gap={0}>
              {shownUsers.map((user, index) => {
                const r = rights[user.userId] ?? { app: false, email: false }
                return (
                  <div
                    key={user.userId}
                    style={{
                      padding: '10px 0',
                      borderTop: index === 0 ? undefined : '1px solid var(--mantine-color-default-border)',
                    }}
                  >
                    <Group gap={6} wrap="wrap">
                      <Text fz="sm" fw={500}>
                        {user.fullName}
                      </Text>
                      {user.isAdministrator ? (
                        <Badge size="xs" variant="light" color="grape">
                          Administrator
                        </Badge>
                      ) : null}
                    </Group>
                    <Text fz="xs" c="dimmed">
                      {user.roles ?? '-'}
                    </Text>
                    {user.email ? (
                      <Text fz="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {user.email}
                      </Text>
                    ) : (
                      <Badge size="sm" variant="light" color="orange" mt={4}>
                        No email
                      </Badge>
                    )}
                    <Group gap="lg" mt={8}>
                      <Checkbox
                        label="In the app"
                        aria-label={`${user.fullName} approves in the app`}
                        checked={r.app}
                        onChange={(event) => setRight(user.userId, 'app', event.currentTarget.checked)}
                      />
                      <Tooltip
                        label="Add an email address to this user to approve by email"
                        withArrow
                        disabled={!!user.email}
                      >
                        <span style={{ display: 'inline-flex' }}>
                          <Checkbox
                            label="By email"
                            aria-label={`${user.fullName} approves by email`}
                            checked={user.email ? r.email : false}
                            disabled={!user.email}
                            onChange={(event) => setRight(user.userId, 'email', event.currentTarget.checked)}
                          />
                        </span>
                      </Tooltip>
                    </Group>
                  </div>
                )
              })}
              {shownUsers.length === 0 ? (
                <Text fz="sm" c="dimmed" ta="center" py="sm">
                  No user matches the search.
                </Text>
              ) : null}
            </Stack>
          ) : (
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Roles</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th w={110} ta="center">
                      In the app
                    </Table.Th>
                    <Table.Th w={110} ta="center">
                      By email
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shownUsers.map((user) => {
                    const r = rights[user.userId] ?? { app: false, email: false }
                    return (
                      <Table.Tr key={user.userId}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text fz="sm" fw={500}>
                              {user.fullName}
                            </Text>
                            {user.isAdministrator ? (
                              <Badge size="xs" variant="light" color="grape">
                                Administrator
                              </Badge>
                            ) : null}
                          </Group>
                          <Text fz="xs" c="dimmed">
                            {user.userName}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text fz="sm">{user.roles ?? '-'}</Text>
                        </Table.Td>
                        <Table.Td>
                          {user.email ? (
                            <Text fz="sm">{user.email}</Text>
                          ) : (
                            <Badge size="sm" variant="light" color="orange">
                              No email
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td ta="center">
                          <Checkbox
                            aria-label={`${user.fullName} approves in the app`}
                            checked={r.app}
                            onChange={(event) => setRight(user.userId, 'app', event.currentTarget.checked)}
                            styles={{ body: { justifyContent: 'center' } }}
                          />
                        </Table.Td>
                        <Table.Td ta="center">
                          {user.email ? (
                            <Checkbox
                              aria-label={`${user.fullName} approves by email`}
                              checked={r.email}
                              onChange={(event) => setRight(user.userId, 'email', event.currentTarget.checked)}
                              styles={{ body: { justifyContent: 'center' } }}
                            />
                          ) : (
                            <Tooltip label="Add an email address to this user to approve by email" withArrow>
                              <span style={{ display: 'inline-flex' }}>
                                <Checkbox
                                  aria-label={`${user.fullName} approves by email`}
                                  checked={false}
                                  disabled
                                  readOnly
                                  styles={{ body: { justifyContent: 'center' } }}
                                />
                              </span>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                  {shownUsers.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Text fz="sm" c="dimmed" ta="center" py="sm">
                          No user matches the search.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : null}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>

        {data.settings.updatedAtUtc ? (
          <Text fz="xs" c="dimmed">
            Last saved {data.settings.updatedByName ? `by ${data.settings.updatedByName} ` : ''}on{' '}
            {formatDateTime(data.settings.updatedAtUtc)}.
          </Text>
        ) : null}
      </Stack>

      <Paper
        radius="lg"
        p="md"
        withBorder
        mt="md"
        style={{ position: 'sticky', bottom: 'var(--app-shell-footer-height, 44px)', zIndex: 3 }}
      >
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Text fz="sm" c={dirty ? 'orange.8' : 'dimmed'}>
            {dirty ? 'Unsaved changes' : 'No changes'}
          </Text>
          <Group gap="sm">
            <Button variant="default" disabled={!dirty || saving} onClick={() => apply(data)}>
              Discard changes
            </Button>
            <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </Group>
        </Group>
      </Paper>
    </form>
  )
}
