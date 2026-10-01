import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, NumberInput, Paper, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { IconRestore } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { settingsApi, type SettingDto } from '../../api/settings'
import { formatDateTime } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { invalidateSettings } from '../../settings/useSetting'

/**
 * Every global setting, drawn from its DEFINITION - there is no screen per setting. A new setting is a
 * row in the database; this page shows it under its group with the right control for its type, and
 * the server decides what is a valid value.
 *
 * A yes / no switch saves the moment it is flipped (it is one decision); a number or text asks for an
 * explicit Save, because half-typed input is not a setting yet.
 */
export function SettingsPage() {
  const [settings, setSettings] = useState<SettingDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSettings(await settingsApi.list())
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingDto[]>()
    for (const setting of settings) {
      const list = byGroup.get(setting.groupName)
      if (list) list.push(setting)
      else byGroup.set(setting.groupName, [setting])
    }
    return [...byGroup.entries()]
  }, [settings])

  /** Replaces one setting with the server's answer, and tells every screen reading it to ask again. */
  function applied(saved: SettingDto) {
    setSettings((current) => current.map((s) => (s.settingKey === saved.settingKey ? saved : s)))
    invalidateSettings()
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="System-wide settings. A change takes effect for everyone straight away." />

      {error ? (
        <Alert color="red" mb="md" title="Could not load settings">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : groups.length === 0 && !error ? (
        <Paper radius="lg" p="xl" withBorder>
          <Text c="dimmed" ta="center">
            No settings are defined yet.
          </Text>
        </Paper>
      ) : (
        <Stack gap="lg">
          {groups.map(([group, items]) => (
            <Paper key={group} radius="lg" p="md" withBorder>
              <Title order={4} mb="sm">
                {group}
              </Title>
              <Stack gap={0}>
                {items.map((setting, index) => (
                  <SettingRow key={setting.settingKey} setting={setting} first={index === 0} onApplied={applied} />
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  )
}

interface SettingRowProps {
  setting: SettingDto
  first: boolean
  onApplied(saved: SettingDto): void
}

function SettingRow({ setting, first, onApplied }: SettingRowProps) {
  const [busy, setBusy] = useState(false)
  // What the reader has typed but not saved yet. Null means the box shows the saved value.
  const [draft, setDraft] = useState<string | null>(null)

  const shown = draft ?? setting.value
  const dirty = draft !== null && draft !== setting.value

  async function save(value: string) {
    setBusy(true)
    try {
      onApplied(await settingsApi.save(setting.settingKey, value))
      setDraft(null)
      notify.success(`${setting.label} saved.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : `${setting.label} could not be saved.`)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    const confirmed = await confirm({
      title: 'Reset to default',
      message: `Put "${setting.label}" back to its default (${describe(setting, setting.defaultValue)})?`,
      confirmLabel: 'Reset',
    })
    if (!confirmed) return

    setBusy(true)
    try {
      onApplied(await settingsApi.reset(setting.settingKey))
      setDraft(null)
      notify.success(`${setting.label} reset to its default.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : `${setting.label} could not be reset.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group
      justify="space-between"
      align="flex-start"
      wrap="nowrap"
      py="sm"
      style={first ? undefined : { borderTop: '1px solid var(--mantine-color-default-border)' }}
    >
      <div style={{ minWidth: 0 }}>
        <Group gap="xs" mb={2}>
          <Text fw={600}>{setting.label}</Text>
          <Badge size="xs" variant="light" color={setting.isDefault ? 'gray' : 'blue'}>
            {setting.isDefault ? 'Default' : 'Changed'}
          </Badge>
        </Group>
        {setting.description ? (
          <Text fz="sm" c="dimmed">
            {setting.description}
          </Text>
        ) : null}
        {!setting.isDefault && setting.updatedAtUtc ? (
          <Text fz="xs" c="dimmed" mt={4}>
            Changed {setting.updatedByName ? `by ${setting.updatedByName} ` : ''}on {formatDateTime(setting.updatedAtUtc)}
          </Text>
        ) : null}
      </div>

      <Group gap="xs" wrap="nowrap" align="center">
        {setting.valueType === 'bool' ? (
          <Switch
            aria-label={setting.label}
            checked={isTrue(setting.value)}
            disabled={busy}
            onChange={(event) => void save(event.currentTarget.checked ? 'true' : 'false')}
            onLabel="On"
            offLabel="Off"
            size="md"
          />
        ) : setting.valueType === 'text' ? (
          <TextInput
            aria-label={setting.label}
            value={shown}
            w={260}
            disabled={busy}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        ) : (
          <NumberInput
            aria-label={setting.label}
            value={shown === '' ? '' : Number(shown)}
            w={140}
            disabled={busy}
            min={setting.minValue ?? undefined}
            max={setting.maxValue ?? undefined}
            decimalScale={setting.valueType === 'int' ? 0 : 4}
            allowDecimal={setting.valueType === 'decimal'}
            onChange={(next) => setDraft(next === '' ? '' : String(next))}
          />
        )}

        {setting.valueType !== 'bool' ? (
          <Button size="xs" onClick={() => void save(shown)} disabled={!dirty || busy} loading={busy && dirty}>
            Save
          </Button>
        ) : null}

        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconRestore size={14} />}
          onClick={() => void reset()}
          disabled={setting.isDefault || busy}
          aria-label={`Reset ${setting.label} to default`}
        >
          Reset
        </Button>
      </Group>
    </Group>
  )
}

function isTrue(value: string): boolean {
  return ['true', '1', 'yes'].includes(value.toLowerCase())
}

/** A value as a person reads it: On / Off for a switch, the text itself otherwise. */
function describe(setting: SettingDto, value: string): string {
  return setting.valueType === 'bool' ? (isTrue(value) ? 'On' : 'Off') : value
}
