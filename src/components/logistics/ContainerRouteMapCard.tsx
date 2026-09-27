import { useEffect, useMemo, useState } from 'react'
import { Paper, Title } from '@mantine/core'
import { containersApi, type TrackingDto } from '../../api/logistics/containers'
import { RouteMap } from './RouteMap'

/**
 * The route map of one container, for the container page. Renders nothing until the tracking is
 * loaded, and nothing at all for a container with no movement — the route timeline below it already
 * says so in words.
 */
export function ContainerRouteMapCard({ containerId }: { containerId: number }) {
  const [data, setData] = useState<TrackingDto | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    containersApi
      .tracking({ containerId }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch(() => {
        // The map is an extra on the container page; a failed load leaves the rest of the page alone.
        if (!controller.signal.aborted) setData(null)
      })
    return () => controller.abort()
  }, [containerId])

  const container = data?.containers.find((c) => c.id === containerId)
  const legs = useMemo(() => data?.legs.filter((leg) => leg.containerId === containerId) ?? [], [data, containerId])
  if (!container || legs.length === 0) return null

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Route map
      </Title>
      <RouteMap container={container} legs={legs} compact />
    </Paper>
  )
}
