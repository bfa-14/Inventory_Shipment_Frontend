import { useState } from 'react'
import { Anchor, Badge, Group, Paper, Stack, Text, Timeline, Title } from '@mantine/core'
import { stamp } from './documentKind'

/** What every family's audit row carries; the stock, sales and purchase DTOs satisfy it as they are. */
export interface AuditEntry {
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

/** How many entries are worth showing before somebody asks for the rest. */
const PREVIEW = 5

const ACTION_COLOURS: Record<string, string> = {
  Created: 'blue',
  Updated: 'blue',
  Posted: 'green',
  Cancelled: 'red',
  FileAdded: 'gray',
  FileDeleted: 'gray',
}

/**
 * What has happened to this document, newest first.
 *
 * IT IS THE ANSWER TO "WHO POSTED THIS". A stock document moves real quantities and the question
 * asked about it weeks later is always about a person and a time, not about the values — so the
 * trail sits on the document itself rather than in a separate audit screen nobody opens.
 *
 * FIVE ENTRIES, THEN THE REST ON ASKING. A document that has been edited eleven times would
 * otherwise push its own lines off the screen with its history.
 */
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? entries : entries.slice(0, PREVIEW)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Activity
      </Title>

      {entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing yet. Saving this document will be its first entry.
        </Text>
      ) : (
        <Stack gap="sm">
          <Timeline bulletSize={14} lineWidth={2}>
            {shown.map((entry, index) => (
              <Timeline.Item key={`${entry.atUtc}-${index}`}>
                <Group gap="xs" wrap="nowrap">
                  <Badge size="sm" variant="light" color={ACTION_COLOURS[entry.action] ?? 'gray'}>
                    {entry.action}
                  </Badge>
                  <Text size="sm">{entry.userName ?? 'System'}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {stamp(entry.atUtc)}
                </Text>
                {entry.details && (
                  <Text size="xs" c="dimmed">
                    {entry.details}
                  </Text>
                )}
              </Timeline.Item>
            ))}
          </Timeline>

          {entries.length > PREVIEW && (
            <Anchor component="button" type="button" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : `Show all ${entries.length} entries`}
            </Anchor>
          )}
        </Stack>
      )}
    </Paper>
  )
}
