import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Group, ScrollArea, Text } from '@mantine/core'
import { useElementSize, useReducedMotion } from '@mantine/hooks'
import { IconAnchor, IconBuildingWarehouse, IconFlag, IconMapPin } from '@tabler/icons-react'
import dayjs from 'dayjs'
import type { TrackingContainerDto, TrackingLegDto } from '../../api/logistics/containers'
import './routeMap.css'

/*
 * The route of one container, drawn left to right on a gentle curve.
 *
 * Stops are the places in route order: the first leg's "from", then every leg's "to", with a leg
 * that starts and ends in the same place (customs at the border post, handling at the port) shown
 * as a badge on its stop instead of a line. The container itself is drawn where it is: on a ship or
 * a truck part-way along the leg in progress, parked at the last place it reached, or at the
 * warehouse once offloaded.
 *
 * Plain SVG and CSS on purpose — no map library, no tiles, works offline.
 */

interface RouteMapProps {
  container: TrackingContainerDto
  legs: TrackingLegDto[]
  /** Shorter, smaller labels — for the container page and the "All" list. */
  compact?: boolean
}

interface Stop {
  code: string
  name: string
  country: string | null
  kind: string
  /** Same-place legs (Port / Customs / Border work) done at this stop. */
  badges: TrackingLegDto[]
}

/** Links stop i to stop i + 1. `gap` when two legs do not join up; `warehouse` for the last drive home. */
interface Segment {
  kind: 'leg' | 'gap' | 'warehouse'
  leg: TrackingLegDto | null
}

type Vehicle = 'ship' | 'truck' | 'box'

interface Placement {
  /** Position on the route: stop index plus the fraction of the next segment. */
  at: number
  /** Where the vehicle starts its first drive from (the start of its leg). */
  from: number
  vehicle: Vehicle
  /** Which stop the container is heading for, if any. */
  nextStop: number | null
}

interface Route {
  stops: Stop[]
  segments: Segment[]
  placement: Placement
}

interface Point {
  x: number
  y: number
}

const ATWAREHOUSE_STATUSES = new Set<number>([6, 7])

const SIZES = {
  full: { segMin: 190, pad: 88, trackY: 80, amp: 9, r: 12, icon: 14, nameFs: 12, countryFs: 10.5, badgeH: 17, badgeFs: 10, scale: 1 },
  compact: { segMin: 150, pad: 70, trackY: 60, amp: 6, r: 9, icon: 11, nameFs: 10.5, countryFs: 9.5, badgeH: 15, badgeFs: 9, scale: 0.76 },
} as const

type Sizes = (typeof SIZES)[keyof typeof SIZES]

/* ── building the route from the legs ───────────────────────────────────────────────────────── */

function buildRoute(container: TrackingContainerDto, legs: TrackingLegDto[]): Route {
  const sorted = [...legs].sort((a, b) => a.seq - b.seq || a.movementId - b.movementId)
  const stops: Stop[] = []
  const segments: Segment[] = []
  const push = (code: string, name: string, kind: string, country: string | null) => {
    stops.push({ code, name, kind, country, badges: [] })
  }

  for (const leg of sorted) {
    const last = stops.at(-1)
    if (!last) {
      push(leg.fromCode, leg.fromName, leg.fromKind, leg.fromCountry)
    } else if (last.code !== leg.fromCode) {
      push(leg.fromCode, leg.fromName, leg.fromKind, leg.fromCountry)
      segments.push({ kind: 'gap', leg: null })
    }
    const here = stops[stops.length - 1]!
    if (leg.toCode === here.code) {
      here.badges.push(leg)
    } else {
      push(leg.toCode, leg.toName, leg.toKind, leg.toCountry)
      segments.push({ kind: 'leg', leg })
    }
  }

  const atWarehouse = ATWAREHOUSE_STATUSES.has(container.status)
  if (atWarehouse && container.warehouseName) {
    const last = stops.at(-1)
    if (!last || last.name !== container.warehouseName) {
      if (last) segments.push({ kind: 'warehouse', leg: null })
      push('', container.warehouseName, 'Warehouse', null)
    } else {
      last.kind = 'Warehouse'
    }
  }

  return { stops, segments, placement: place(stops, segments, sorted, atWarehouse) }
}

function place(stops: Stop[], segments: Segment[], legs: TrackingLegDto[], atWarehouse: boolean): Placement {
  const lastStop = Math.max(0, stops.length - 1)
  if (atWarehouse) return { at: lastStop, from: lastStop, vehicle: 'box', nextStop: null }

  const current = legs.find((leg) => leg.status === 2)
  if (current) {
    const vehicle: Vehicle = current.stage === 'Sea' ? 'ship' : 'truck'
    const segment = segments.findIndex((s) => s.leg === current)
    if (segment >= 0) {
      const pct = Math.min(100, Math.max(0, current.progressPct)) / 100
      return { at: segment + pct, from: segment, vehicle, nextStop: segment + 1 }
    }
    const stop = stops.findIndex((s) => s.badges.includes(current))
    if (stop >= 0) return { at: stop, from: stop, vehicle, nextStop: null }
  }

  // Nothing on the move: the box waits at the last place a completed leg brought it to.
  let reached = 0
  segments.forEach((s, i) => {
    if (s.leg?.status === 3) reached = i + 1
  })
  stops.forEach((s, i) => {
    if (s.badges.some((b) => b.status === 3)) reached = Math.max(reached, i)
  })
  const next = reached < lastStop ? reached + 1 : null
  return { at: reached, from: reached, vehicle: 'box', nextStop: next }
}

/* ── geometry ───────────────────────────────────────────────────────────────────────────────── */

/** Cubic Bézier between two stops with horizontal tangents — the gentle S between every pair. */
function controls(a: Point, b: Point): [Point, Point, Point, Point] {
  const dx = (b.x - a.x) * 0.45
  return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b]
}

function bezier([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function derivative([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  }
}

/** A polyline along the segment from t0 to t1, optionally rippled along its normal (the sea). */
function sampledPath(curve: [Point, Point, Point, Point], t0: number, t1: number, wave: boolean): string {
  if (t1 - t0 <= 0.0001) return ''
  const chord = Math.hypot(curve[3].x - curve[0].x, curve[3].y - curve[0].y)
  const length = chord * (t1 - t0)
  const count = Math.max(4, Math.ceil(length / (wave ? 2.5 : 6)))
  const parts: string[] = []
  for (let i = 0; i <= count; i++) {
    const t = t0 + ((t1 - t0) * i) / count
    const p = bezier(curve, t)
    let { x, y } = p
    if (wave) {
      const d = derivative(curve, t)
      const n = Math.hypot(d.x, d.y) || 1
      const offset = 2.6 * Math.sin((2 * Math.PI * t * chord) / 16)
      x += (-d.y / n) * offset
      y += (d.x / n) * offset
    }
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return parts.join(' ')
}

/* ── words ──────────────────────────────────────────────────────────────────────────────────── */

function day(value: string | null): string | null {
  return value ? dayjs(value).format('D MMM YYYY') : null
}

const LEG_STATUS: Record<number, string> = { 1: 'Planned', 2: 'In progress', 3: 'Completed' }

function legTitle(leg: TrackingLegDto): string {
  const lines = [`${leg.movementNo} · ${leg.typeName}`, `${leg.fromName} → ${leg.toName}`]
  if (leg.carrierName) lines.push(`Carrier: ${leg.carrierName}`)
  if (leg.vehicleOrVessel) {
    const voyage = leg.voyageNo ? ` (voyage ${leg.voyageNo})` : ''
    lines.push(`${leg.stage === 'Sea' ? 'Vessel' : 'Vehicle'}: ${leg.vehicleOrVessel}${voyage}`)
  }
  const dates: [string, string | null][] = [
    ['Planned', day(leg.plannedDate)],
    ['Started', day(leg.startDate)],
    ['ETA', day(leg.eta)],
    ['Arrived', day(leg.endDate)],
  ]
  for (const [label, value] of dates) if (value) lines.push(`${label}: ${value}`)
  const status = LEG_STATUS[leg.status] ?? String(leg.status)
  const progress = leg.status === 2 ? ` · ${Math.round(leg.progressPct)}%` : ''
  lines.push(`${status}${progress}${leg.isLate ? ' · LATE' : ''}`)
  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

/* ── motion ─────────────────────────────────────────────────────────────────────────────────── */

function ease(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

/** Eases a route position towards `target` with requestAnimationFrame; jumps when motion is reduced. */
function useEasedPosition(target: number, start: number, still: boolean): number {
  const [value, setValue] = useState(still ? target : start)
  const current = useRef(value)

  useEffect(() => {
    if (still) {
      current.current = target
      return
    }
    const from = current.current
    if (Math.abs(from - target) < 0.0001) return
    const duration = Math.min(3200, 1100 + Math.abs(target - from) * 1400)
    const began = performance.now()
    let frame = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / duration)
      const next = from + (target - from) * ease(k)
      current.current = next
      setValue(next)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, still])

  return still ? target : value
}

/* ── drawings ───────────────────────────────────────────────────────────────────────────────── */

function Motorcycle({ x, y }: { x: number; y: number }) {
  return (
    <g className="rm-moto" transform={`translate(${x} ${y})`}>
      <circle cx={-4} cy={-2.4} r={2.3} />
      <circle cx={4.2} cy={-2.4} r={2.3} />
      <path d="M-4 -2.4 L-1 -5.4 L2.8 -5.4 L4.2 -2.4 M-1.8 -6.3 L1.6 -6.3 M2.4 -5.4 L3.4 -8 L5.2 -8" />
    </g>
  )
}

/** The container: bottom-centre at (0, 0), open on the side to show the motorcycles, number below. */
function ContainerBox({ label }: { label: string }) {
  const w = 48
  const h = 28
  const long = label.length > 11
  return (
    <g>
      <rect className="rm-box" x={-w / 2} y={-h} width={w} height={h} rx={1.5} />
      <line className="rm-box-rib" x1={-w / 2 + 1} y1={-h + 1.6} x2={w / 2 - 1} y2={-h + 1.6} />
      <rect className="rm-box-window" x={-w / 2 + 3} y={-h + 3} width={w - 6} height={h - 12} rx={1} />
      <Motorcycle x={-12} y={-10} />
      <Motorcycle x={1} y={-10} />
      <Motorcycle x={14} y={-10} />
      <text
        className="rm-box-label"
        x={0}
        y={-2.6}
        fontSize={6}
        textAnchor="middle"
        textLength={long ? w - 6 : undefined}
        lengthAdjust={long ? 'spacingAndGlyphs' : undefined}
      >
        {label}
      </text>
    </g>
  )
}

function Truck({ label }: { label: string }) {
  return (
    <g>
      <ellipse className="rm-shadow" cx={-2} cy={0.5} rx={36} ry={2} />
      <rect className="rm-dark" x={-37} y={-10} width={70} height={3.4} rx={1} />
      <g transform="translate(-13 -10)">
        <ContainerBox label={label} />
      </g>
      <path className="rm-cab" d="M13 -8 L13 -29 L27 -29 L34 -20 L35 -8 Z" />
      <path className="rm-glass" d="M16 -26 L26 -26 L31 -20 L16 -20 Z" />
      <rect className="rm-light" x={33} y={-13} width={2.2} height={2.4} rx={0.6} />
      {[-28, -16, 25].map((cx) => (
        <g key={cx}>
          <circle className="rm-dark" cx={cx} cy={-4} r={4.2} />
          <circle className="rm-hub" cx={cx} cy={-4} r={1.6} />
        </g>
      ))}
    </g>
  )
}

function Ship({ label }: { label: string }) {
  return (
    <g>
      <path className="rm-wake" d="M-52 3 q2.5 -2.4 5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0" />
      <g className="rm-rock">
        <path className="rm-hull" d="M-46 -12 L46 -12 L38 4 L-40 4 Z" />
        <path className="rm-boot" d="M-41.5 0.6 L39.7 0.6 L38 4 L-40 4 Z" />
        <rect className="rm-funnel" x={-41} y={-38} width={6} height={8} rx={1} />
        <rect className="rm-bridge" x={-44} y={-31} width={13} height={19} rx={1} />
        <rect className="rm-glass" x={-42} y={-28} width={9} height={3} />
        <g transform="translate(6 -12)">
          <ContainerBox label={label} />
        </g>
      </g>
    </g>
  )
}

function StopIcon({ kind, x, y, size }: { kind: string; x: number; y: number; size: number }) {
  const props = { x: x - size / 2, y: y - size / 2, size, stroke: 2, className: 'rm-stop-icon' }
  if (kind === 'Warehouse') return <IconBuildingWarehouse {...props} />
  if (kind === 'Sea') return <IconAnchor {...props} />
  if (kind === 'Border') return <IconFlag {...props} />
  return <IconMapPin {...props} />
}

interface VehicleLayerProps {
  placement: Placement
  pointAt: (at: number) => Point
  angleAt: (at: number) => number
  still: boolean
  label: string
  scale: number
  /** How far above the route a parked box stands, to clear the stop's circle. */
  boxLift: number
}

function VehicleLayer({ placement, pointAt, angleAt, still, label, scale, boxLift }: VehicleLayerProps) {
  const moving = placement.vehicle !== 'box'
  const at = useEasedPosition(placement.at, placement.from, still || !moving)
  const p = pointAt(at)
  const tilt = moving ? Math.max(-9, Math.min(9, angleAt(at))) * (placement.vehicle === 'ship' ? 0.4 : 0.8) : 0
  const lift = placement.vehicle === 'box' ? boxLift : 2
  const body = placement.vehicle === 'ship' ? <Ship label={label} /> : placement.vehicle === 'truck' ? <Truck label={label} /> : <ContainerBox label={label} />

  return (
    <g transform={`translate(${p.x.toFixed(2)} ${(p.y - lift).toFixed(2)}) rotate(${tilt.toFixed(2)}) scale(${scale})`} pointerEvents="none">
      {moving ? <g className="rm-bob">{body}</g> : body}
    </g>
  )
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <Group gap={6} wrap="nowrap">
      <svg width={30} height={12} aria-hidden>
        {swatch}
      </svg>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  )
  return (
    <Group className="rm-legend" gap="md" mt={4} wrap="wrap">
      {item(<path className="rm-sea" d="M1 6 q3.5 -4 7 0 t7 0 t7 0 t7 0" />, 'Sea')}
      {item(
        <>
          <path className="rm-road" d="M4 6 L26 6" />
          <path className="rm-road-line" d="M4 6 L26 6" />
        </>,
        'Road',
      )}
      {item(<path className="rm-road is-planned" d="M2 6 L28 6" />, 'Planned')}
      {item(<path className="rm-road is-late" d="M4 6 L26 6" />, 'Late')}
    </Group>
  )
}

/* ── the map ────────────────────────────────────────────────────────────────────────────────── */

export function RouteMap({ container, legs, compact = false }: RouteMapProps) {
  const reducedMotion = useReducedMotion()
  const { ref, width } = useElementSize()
  const route = useMemo(() => buildRoute(container, legs), [container, legs])
  const S: Sizes = compact ? SIZES.compact : SIZES.full

  const { stops, segments, placement } = route
  const segCount = Math.max(0, stops.length - 1)
  const minWidth = S.pad * 2 + Math.max(1, segCount) * S.segMin
  const W = Math.max(minWidth, Math.floor(width))
  const segWidth = segCount > 0 ? (W - 2 * S.pad) / segCount : W - 2 * S.pad

  const points: Point[] = stops.map((_, i) => ({
    x: segCount === 0 ? W / 2 : S.pad + i * segWidth,
    y: S.trackY + (i % 2 === 0 ? -S.amp : S.amp),
  }))
  const curves = segments.map((_, i) => controls(points[i]!, points[i + 1]!))

  const locate = (at: number): [number, number] => {
    if (curves.length === 0) return [-1, 0]
    const i = Math.min(curves.length - 1, Math.max(0, Math.floor(at)))
    return [i, Math.min(1, Math.max(0, at - i))]
  }
  const pointAt = (at: number): Point => {
    const [i, t] = locate(at)
    if (i < 0) return points[0] ?? { x: W / 2, y: S.trackY }
    return bezier(curves[i]!, t)
  }
  const angleAt = (at: number): number => {
    const [i, t] = locate(at)
    if (i < 0) return 0
    const d = derivative(curves[i]!, t)
    return (Math.atan2(d.y, d.x) * 180) / Math.PI
  }

  const labelY = S.trackY + S.amp + S.r + S.nameFs + 6
  const countryY = labelY + S.countryFs + 3
  const badgeTop = countryY + 8
  const maxBadges = stops.reduce((max, s) => Math.max(max, s.badges.length), 0)
  const H = badgeTop + maxBadges * (S.badgeH + 4) + 6
  const nameChars = Math.max(8, Math.floor((Math.min(segWidth, 260) - 14) / (S.nameFs * 0.58)))
  const reachedUpTo = Math.floor(placement.at + 0.0001)
  const label = container.containerNo || container.containerRef
  const still = reducedMotion
  const trackPath = curves.map((c, i) => `${i === 0 ? `M${c[0].x} ${c[0].y} ` : ''}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`).join(' ')

  if (stops.length === 0) {
    return (
      <Text c="dimmed" fz="sm">
        No movement is planned for this container yet.
      </Text>
    )
  }

  return (
    <Box ref={ref} className={`rm-root${still ? ' is-still' : ''}`}>
      <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
        <svg
          className="rm-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Route of ${container.containerRef}: ${stops.map((s) => s.name).join(' → ')}`}
        >
          {trackPath ? <path className="rm-track" d={trackPath} /> : null}

          {segments.map((segment, i) => {
            const curve = curves[i]!
            const leg = segment.leg
            if (segment.kind === 'gap') return <path key={`s${i}`} className="rm-gap" d={sampledPath(curve, 0, 1, false)} />

            const sea = leg?.stage === 'Sea'
            const status = leg ? leg.status : 3
            const late = leg?.isLate ? ' is-late' : ''
            const split = status === 3 ? 1 : status === 2 ? Math.min(1, Math.max(0, leg!.progressPct / 100)) : 0
            const base = sea ? 'rm-sea' : 'rm-road'
            const done = sampledPath(curve, 0, split, sea)
            const ahead = sampledPath(curve, split, 1, sea)
            const whole = sampledPath(curve, 0, 1, false)

            return (
              <g key={`s${i}`} className="rm-leg">
                {ahead ? <path className={`${base} is-planned${late}`} d={ahead} /> : null}
                {done ? <path className={`${base}${late}`} d={done} /> : null}
                {done && !sea ? <path className="rm-road-line" d={done} /> : null}
                {done && status === 2 ? <path className="rm-flow" d={done} /> : null}
                <path className="rm-hit" d={whole}>
                  <title>{leg ? legTitle(leg) : `Delivered to ${stops[i + 1]?.name ?? 'the warehouse'}`}</title>
                </path>
              </g>
            )
          })}

          {stops.map((stop, i) => {
            const p = points[i]!
            const reached = i <= reachedUpTo
            const next = i === placement.nextStop
            const classes = ['rm-stop', reached ? 'is-reached' : '', next ? 'is-next' : '', stop.kind === 'Warehouse' ? 'is-warehouse' : '']
              .filter(Boolean)
              .join(' ')
            const where = [stop.name, stop.country].filter(Boolean).join(', ')
            const kindLabel = stop.kind === 'Sea' ? 'Sea port' : stop.kind === 'Warehouse' ? 'Warehouse' : stop.kind
            let badgeY = badgeTop

            return (
              <g key={`p${i}`}>
                <g className={classes}>
                  <title>{`${where}${stop.code ? ` (${stop.code})` : ''}\n${kindLabel}`}</title>
                  {next && !still ? <circle className="rm-stop-ring" cx={p.x} cy={p.y} r={S.r} /> : null}
                  <circle className="rm-stop-dot" cx={p.x} cy={p.y} r={S.r} />
                  <StopIcon kind={stop.kind} x={p.x} y={p.y} size={S.icon} />
                </g>
                <text className="rm-name" x={p.x} y={labelY} fontSize={S.nameFs} textAnchor="middle">
                  {truncate(stop.name, nameChars)}
                </text>
                <text className="rm-country" x={p.x} y={countryY} fontSize={S.countryFs} textAnchor="middle">
                  {truncate([stop.country, stop.code].filter(Boolean).join(' · ') || kindLabel, nameChars + 4)}
                </text>
                {stop.badges.map((leg) => {
                  const text = leg.stage && leg.stage !== 'Origin' ? leg.stage : leg.typeName
                  const state = leg.status === 3 ? 'is-done' : leg.status === 2 ? 'is-active' : 'is-planned'
                  const bw = text.length * S.badgeFs * 0.62 + 16
                  const y = badgeY
                  badgeY += S.badgeH + 4
                  return (
                    <g key={leg.movementId} className={`rm-badge ${state}${leg.isLate ? ' is-late' : ''}`}>
                      <title>{legTitle(leg)}</title>
                      <rect x={p.x - bw / 2} y={y} width={bw} height={S.badgeH} rx={S.badgeH / 2} />
                      <text x={p.x} y={y + S.badgeH / 2 + S.badgeFs * 0.36} fontSize={S.badgeFs} textAnchor="middle">
                        {text}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}

          <VehicleLayer
            key={`${container.id}-${placement.vehicle}`}
            placement={placement}
            pointAt={pointAt}
            angleAt={angleAt}
            still={still}
            label={label}
            scale={S.scale}
            boxLift={S.r + 2}
          />
        </svg>
      </ScrollArea>
      {compact ? null : <Legend />}
    </Box>
  )
}
