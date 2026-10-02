import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Loader,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconDeviceFloppy, IconMailForward, IconWorldWww } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../api/http'
import {
  emailSettingsApi,
  type EmailSettingsDto,
  type EmailSettingsValues,
  type SaveEmailSettingsRequest,
  type SmtpSecurity,
} from '../../api/emailSettings'
import { formatDateTime } from '../../components/format'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

type Provider = 'gmail' | 'microsoft' | 'other'

/** The presets: a provider fills the server, the port and the security it needs. */
const PROVIDERS: Record<
  Exclude<Provider, 'other'>,
  { host: string; port: number; security: SmtpSecurity; help: string }
> = {
  gmail: {
    host: 'smtp.gmail.com',
    port: 587,
    security: 1,
    help: 'Use an app password (Google account > Security > 2-Step Verification > App passwords), not the account password.',
  },
  microsoft: {
    host: 'smtp.office365.com',
    port: 587,
    security: 1,
    help: 'SMTP AUTH must be enabled for this mailbox in the Microsoft 365 admin center.',
  },
}

const SECURITY_OPTIONS = [
  { value: '1', label: 'STARTTLS (recommended)' },
  { value: '2', label: 'SSL/TLS' },
  { value: '0', label: 'None' },
]

const CONFLICT_MESSAGE = 'Someone else changed these settings. Reload the page.'

interface FormValues {
  sendingEnabled: boolean
  smtpHost: string
  smtpPort: number | string
  smtpSecurity: string
  smtpUserName: string
  password: string
  fromAddress: string
  fromName: string
  replyToAddress: string
  publicBaseUrl: string
}

const EMPTY: FormValues = {
  sendingEnabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecurity: '1',
  smtpUserName: '',
  password: '',
  fromAddress: '',
  fromName: '',
  replyToAddress: '',
  publicBaseUrl: '',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toForm(settings: EmailSettingsDto): FormValues {
  return {
    sendingEnabled: settings.sendingEnabled,
    smtpHost: settings.smtpHost ?? '',
    smtpPort: settings.smtpPort,
    smtpSecurity: String(settings.smtpSecurity),
    smtpUserName: settings.smtpUserName ?? '',
    password: '',
    fromAddress: settings.fromAddress ?? '',
    fromName: settings.fromName ?? '',
    replyToAddress: settings.replyToAddress ?? '',
    publicBaseUrl: settings.publicBaseUrl ?? '',
  }
}

function detectProvider(host: string): Provider {
  const normalized = host.trim().toLowerCase()
  if (normalized === PROVIDERS.gmail.host) return 'gmail'
  if (normalized === PROVIDERS.microsoft.host) return 'microsoft'
  return 'other'
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** What the server is sent - for a save, and for a test of the values on the screen. */
function toValues(values: FormValues): EmailSettingsValues {
  return {
    sendingEnabled: values.sendingEnabled,
    smtpHost: blankToNull(values.smtpHost),
    smtpPort: Number(values.smtpPort) || 0,
    smtpSecurity: Number(values.smtpSecurity) as SmtpSecurity,
    smtpUserName: blankToNull(values.smtpUserName),
    // Never trimmed: a password is what it is. Empty = keep (or use) the saved one.
    password: values.password === '' ? null : values.password,
    fromAddress: blankToNull(values.fromAddress),
    fromName: blankToNull(values.fromName),
    replyToAddress: blankToNull(values.replyToAddress),
    publicBaseUrl: blankToNull(values.publicBaseUrl),
  }
}

interface TestOutcome {
  ok: boolean
  message: string
}

/**
 * Settings > Email: the mail server and the sender of every email the application sends, the address the
 * links in those emails open, and a test that tries the values on the screen before they are saved.
 *
 * THE PASSWORD FIELD IS NEVER FILLED FROM THE SERVER: it only ever holds what the reader types. A saved one
 * shows as a placeholder and is kept unless replaced or removed.
 */
export function EmailSettingsPage() {
  const { user, hasPermission } = useAuth()
  const [settings, setSettings] = useState<EmailSettingsDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [removePassword, setRemovePassword] = useState(false)
  const [provider, setProvider] = useState<Provider>('other')
  const [testTo, setTestTo] = useState(user?.email ?? '')
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)

  const form = useForm<FormValues>({
    mode: 'controlled',
    initialValues: EMPTY,
    validate: {
      smtpHost: (value, values) =>
        values.sendingEnabled && value.trim() === '' ? 'Enter the mail server to switch sending on.' : null,
      smtpPort: (value) => {
        const port = Number(value)
        return Number.isInteger(port) && port >= 1 && port <= 65535 ? null : 'The port must be between 1 and 65535.'
      },
      fromAddress: (value, values) => {
        if (value.trim() === '') return values.sendingEnabled ? 'Enter the sender address to switch sending on.' : null
        return EMAIL_PATTERN.test(value.trim()) ? null : 'Not a valid email address.'
      },
      replyToAddress: (value) =>
        value.trim() === '' || EMAIL_PATTERN.test(value.trim()) ? null : 'Not a valid email address.',
      publicBaseUrl: (value) =>
        value.trim() === '' || /^https?:\/\/\S+$/i.test(value.trim())
          ? null
          : 'The address must start with http:// or https://.',
    },
  })

  const applySettings = useCallback(
    (next: EmailSettingsDto) => {
      setSettings(next)
      form.setValues(toForm(next))
      form.resetDirty(toForm(next))
      setProvider(detectProvider(next.smtpHost ?? ''))
      setRemovePassword(false)
    },
    // form is stable for the page's lifetime; listing it would re-create the callback on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setConflict(false)
    try {
      applySettings(await emailSettingsApi.get())
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'The email settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [applySettings])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    if (!testTo && user?.email) setTestTo(user.email)
  }, [user?.email, testTo])

  const dirty = form.isDirty() || removePassword

  // Leaving with unsaved changes: the browser asks first (reload, close, typed address).
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function chooseProvider(next: string | null) {
    const chosen = (next ?? 'other') as Provider
    setProvider(chosen)
    if (chosen !== 'other') {
      const preset = PROVIDERS[chosen]
      form.setValues({ smtpHost: preset.host, smtpPort: preset.port, smtpSecurity: String(preset.security) })
    }
  }

  async function save(values: FormValues) {
    if (!settings) return
    setSaving(true)
    const payload: SaveEmailSettingsRequest = {
      ...toValues(values),
      password: removePassword ? null : toValues(values).password,
      removePassword,
      rowVersion: settings.rowVersion,
    }
    try {
      applySettings(await emailSettingsApi.save(payload))
      notify.success('Email settings saved.')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true)
        notify.error(CONFLICT_MESSAGE)
      } else {
        notify.error(error instanceof ApiError ? error.message : 'The email settings could not be saved.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    if (!settings) return
    const to = testTo.trim()
    if (!EMAIL_PATTERN.test(to)) {
      notify.error('Enter a valid email address to send the test to.')
      return
    }
    setTesting(true)
    setTestOutcome(null)
    try {
      const result = await emailSettingsApi.test(to, toValues(form.getValues()))
      // The test is recorded on the settings row: keep its new version, so the next Save is not refused.
      setSettings((current) =>
        current
          ? {
              ...current,
              rowVersion: result.rowVersion,
              lastTestAtUtc: new Date().toISOString(),
              lastTestOk: result.ok,
              lastTestError: result.error,
            }
          : current,
      )
      setTestOutcome(
        result.ok
          ? {
              ok: true,
              message: `Sent in ${(result.durationMs / 1000).toFixed(1)} s - check the inbox and the spam folder.`,
            }
          : { ok: false, message: result.error ?? 'The test email was not sent.' },
      )
    } catch (error) {
      setTestOutcome({ ok: false, message: error instanceof ApiError ? error.message : 'The test could not be run.' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Email" subtitle="The mail server and the sender of every email the application sends." />
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      </>
    )
  }

  if (!settings) {
    return (
      <>
        <PageHeader title="Email" />
        <Alert color="red" title="Could not load the email settings">
          {loadError}
        </Alert>
      </>
    )
  }

  const values = form.getValues()
  const help = provider === 'other' ? null : PROVIDERS[provider].help
  const typedUrl = values.publicBaseUrl.trim()

  return (
    <form onSubmit={form.onSubmit((v) => void save(v))} noValidate>
      <PageHeader title="Email" subtitle="The mail server and the sender of every email the application sends." />

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
          <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
            <Title order={4}>Sending</Title>
            <Badge variant="light" color={settings.isSaved ? 'green' : 'orange'}>
              {settings.isSaved ? 'Saved' : 'Not set up yet'}
            </Badge>
          </Group>
          <Switch label="Send emails" size="md" {...form.getInputProps('sendingEnabled', { type: 'checkbox' })} />
          <Text fz="sm" c="dimmed" mt="xs">
            When off, emails are kept in the Email log and nothing leaves the server.{' '}
            {hasPermission(PERMISSIONS.emailsView) ? (
              <Anchor component={Link} to="/configuration/email-log" fz="sm">
                Open the Email log
              </Anchor>
            ) : null}
          </Text>
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            Sender
          </Title>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="From address"
                placeholder="purchasing@example.com"
                withAsterisk={values.sendingEnabled}
                {...form.getInputProps('fromAddress')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label="From name" placeholder="Katanga TVS - Purchasing" {...form.getInputProps('fromName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Reply-to address"
                placeholder="Optional"
                description="Where replies go when they should not go to the sender address."
                {...form.getInputProps('replyToAddress')}
              />
            </Grid.Col>
          </Grid>
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            Mail server
          </Title>
          {settings.passwordUnreadable && !removePassword ? (
            <Alert color="red" mb="md">
              The saved password can no longer be read: type it again.
            </Alert>
          ) : null}
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                label="Provider"
                data={[
                  { value: 'gmail', label: 'Gmail' },
                  { value: 'microsoft', label: 'Microsoft 365' },
                  { value: 'other', label: 'Other' },
                ]}
                value={provider}
                onChange={chooseProvider}
                allowDeselect={false}
              />
              {help ? (
                <Text fz="xs" c="dimmed" mt={6}>
                  {help}
                </Text>
              ) : null}
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }} />
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Host"
                placeholder="smtp.example.com"
                withAsterisk={values.sendingEnabled}
                {...form.getInputProps('smtpHost')}
                onChange={(event) => {
                  form.setFieldValue('smtpHost', event.currentTarget.value)
                  setProvider(detectProvider(event.currentTarget.value))
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <NumberInput
                label="Port"
                min={1}
                max={65535}
                allowDecimal={false}
                allowNegative={false}
                {...form.getInputProps('smtpPort')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Select
                label="Security"
                data={SECURITY_OPTIONS}
                allowDeselect={false}
                {...form.getInputProps('smtpSecurity')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="User name"
                placeholder="Usually the mailbox address"
                autoComplete="off"
                {...form.getInputProps('smtpUserName')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <PasswordInput
                label="Password"
                autoComplete="new-password"
                placeholder={settings.hasPassword && !removePassword ? 'Saved - type to replace' : 'Not set'}
                disabled={removePassword}
                {...form.getInputProps('password')}
              />
              {settings.hasPassword ? (
                removePassword ? (
                  <Text fz="xs" c="orange.8" mt={6}>
                    The saved password will be removed when you save.{' '}
                    <Anchor component="button" type="button" fz="xs" onClick={() => setRemovePassword(false)}>
                      Keep it
                    </Anchor>
                  </Text>
                ) : (
                  <Anchor
                    component="button"
                    type="button"
                    fz="xs"
                    c="red"
                    mt={6}
                    onClick={() => {
                      form.setFieldValue('password', '')
                      setRemovePassword(true)
                    }}
                  >
                    Remove password
                  </Anchor>
                )
              ) : null}
            </Grid.Col>
          </Grid>
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            Links in emails
          </Title>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <TextInput
                label="Address of the application"
                placeholder="https://erp.example.com"
                description="Approval links in emails open this address."
                {...form.getInputProps('publicBaseUrl')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Button
                variant="default"
                fullWidth
                leftSection={<IconWorldWww size={16} />}
                onClick={() => form.setFieldValue('publicBaseUrl', window.location.origin)}
              >
                Use this address
              </Button>
            </Grid.Col>
          </Grid>
          {typedUrl === '' && settings.effectivePublicBaseUrl ? (
            <Text fz="sm" c="dimmed" mt="sm">
              Used now: {settings.effectivePublicBaseUrl} (from the configuration file).
            </Text>
          ) : null}
          {typedUrl === '' && !settings.effectivePublicBaseUrl ? (
            <Alert color="orange" mt="sm">
              No address is set: purchase orders cannot be sent for approval until the address of the application is
              entered here.
            </Alert>
          ) : null}
        </Paper>

        <Paper radius="lg" p="md" withBorder>
          <Title order={4} mb="sm">
            Test
          </Title>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <TextInput
                label="Send a test email to"
                description="Uses the values on the screen, saved or not."
                value={testTo}
                onChange={(event) => setTestTo(event.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Button
                fullWidth
                leftSection={<IconMailForward size={16} />}
                loading={testing}
                onClick={() => void sendTest()}
              >
                Send test email
              </Button>
            </Grid.Col>
          </Grid>
          {testOutcome ? (
            <Alert color={testOutcome.ok ? 'green' : 'red'} mt="md">
              {testOutcome.message}
            </Alert>
          ) : null}
          {settings.lastTestAtUtc ? (
            <Text fz="sm" c="dimmed" mt="sm">
              Last test: {formatDateTime(settings.lastTestAtUtc)} -{' '}
              {settings.lastTestOk ? (
                <Text span fz="sm" c="green.8" fw={600}>
                  OK
                </Text>
              ) : (
                <Text span fz="sm" c="red.8">
                  failed: {settings.lastTestError ?? 'unknown error'}
                </Text>
              )}
            </Text>
          ) : null}
        </Paper>

        {settings.updatedAtUtc ? (
          <Text fz="xs" c="dimmed">
            Last saved {settings.updatedByName ? `by ${settings.updatedByName} ` : ''}on{' '}
            {formatDateTime(settings.updatedAtUtc)}.
          </Text>
        ) : null}
      </Stack>

      <Paper
        radius="lg"
        p="md"
        withBorder
        mt="md"
        // Sits just above the app's own footer, so Save is reachable without scrolling to the end.
        style={{ position: 'sticky', bottom: 'var(--app-shell-footer-height, 44px)', zIndex: 3 }}
      >
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Text fz="sm" c={dirty ? 'orange.8' : 'dimmed'}>
            {dirty ? 'Unsaved changes' : 'No changes'}
          </Text>
          <Group gap="sm">
            <Button variant="default" disabled={!dirty || saving} onClick={() => applySettings(settings)}>
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
