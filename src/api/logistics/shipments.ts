import { request } from '../http'
import { toQueryString, type ContainerShipState, type ContainerStatusCode } from './containers'

/**
 * LOGISTICS › SHIPMENTS (script 82, shipment phase 3): every container on its way, in one column by stage - At supplier,
 * At sea, At port, On the road, At border / customs, Delivered, to receive, and with "Show received (30 days)" the ones
 * received since. Where a container stands is the database's (`logistics.fn_Container_BoardPhase`), from the same
 * movements as its next step, so the board, the container page and the Containers list never disagree. Moving a container
 * is the Next step dialogs' (`nextStepApi`), never the board's: every move writes a movement with its dates.
 *
 * Needs containers.shipments.view (403 without). Movement numbers come back whatever the reader may open: the page links
 * them only with containers.movements.view.
 */
const BASE = '/api/logistics/shipments'

/** The columns, left to right. Received only with showReceived. */
export type ShipmentPhase = 'AtSupplier' | 'AtSea' | 'AtPort' | 'OnTheRoad' | 'AtBorderCustoms' | 'Delivered' | 'Received'

/** One column: its title and what it holds after the filters. */
export interface ShipmentColumnDto {
  phase: ShipmentPhase
  /** "At supplier", "At sea", "At port", "On the road", "At border / customs", "Delivered, to receive", "Received (30 days)". */
  title: string
  phaseOrder: number
  count: number
  pieces: number
}

/**
 * One card. The names are the Containers list row's (its ship state, next step and proposed leg), so the page words a
 * step with the same `nextStep.ts` and ticks cards into the same selection bar. ONLY WHAT THE BOARD, ITS LIST AND ITS
 * DRAWER READ, AND THE ANSWER LEAVES OUT EMPTY FIELDS (a board of 5,000 cards was 11.9 MB, 45% of it nulls; it is
 * 3.6 MB): an absent field reads as null. Of ContainerShipState the card carries movementCount, placeName, the leg in
 * progress (id, no., type, stage, To, ETA), the planned leg (id, no., type, stage, To), the next step and the proposed
 * leg's type, stage, To and stay - what `nextStepOf` words a step with. The drawer reads the container itself.
 */
export interface ShipmentCardDto extends ContainerShipState {
  id: number
  containerRef: string
  /** Null: the badge "No container no." (filled in by `board` when the answer leaves it out). */
  containerNo: string | null
  containerTypeCode: string
  status: ContainerStatusCode
  /** The order the container was created from; `orderNumbers` summarises every order on it ("PO-… +1"). */
  purchaseOrderId?: number | null
  purchaseOrderNumber?: string | null
  orderCount: number
  orderNumbers?: string | null
  /** "Hero MotoCorp +1". */
  supplierNames?: string | null
  /** "84 pcs TVS-APACHE-160" with one item (its code), else "2 items, 120 pcs". */
  itemCount: number
  itemCode?: string | null
  totalQtyBase: number
  /** The last free day at the port: the tooltip of "Free time over". */
  lastFreeDay?: string | null

  /* the board */
  phase: ShipmentPhase
  /** Its group in the column, an opaque key ("MOV|46", "LEG|4|7", "AT|4", "WH|1"). */
  groupKey: string
  /** The group's words without its count ("MOV-2026-000046 · MSC Aurora V.123 · Chennai → Dar es Salaam · ETA 20/10/2026"). */
  groupLabel: string
  /** The group's place in its column (1 = first). */
  groupOrder: number
  /** Since when it stands where it is: a stay since its start, else the end of the leg that brought it, the delivery, the receipt. */
  atPlaceSince?: string | null
  /** Red "Late": the leg in progress has an ETA before today. */
  isLate: boolean
  /** Red "Free time over": the rule of the container page, the Tracking board and the Dashboard. */
  isFreeTimeOver: boolean
  /**
   * Followed by typed dates: no leg started or completed, In Transit / At Port / Cleared by the dates typed on it - the
   * card reads "Followed by typed dates" instead of "Not moved yet". Absent otherwise.
   */
  followedByTypedDates?: boolean | null

  /** The leg in progress beyond ContainerShipState: the truck or the vessel. */
  activeMovementVehicleOrVessel?: string | null
  /** 2 in progress, 3 completed: the selection bar's "Select not shipped". */
  currentMovementStatus?: number | null

  /* its goods receipt: the badge "GRN draft" (status 1), the number once received */
  goodsReceiptId?: number | null
  goodsReceiptNumber?: string | null
  goodsReceiptStatus?: 1 | 2 | null
}

export interface ShipmentBoardDto {
  columns: ShipmentColumnDto[]
  /** Every card, in the order of the board: column, group, ref. No paging. */
  containers: ShipmentCardDto[]
}

/** The filters, all on the server. An id of 0 or less is refused (400). */
export interface ShipmentBoardQuery {
  /** Ref, container no., B/L, vessel (or the truck of the leg in progress), purchase order number. */
  search?: string
  supplierId?: number
  purchaseOrderId?: number
  branchId?: number
  /** Where it stands, or the From or the To of the leg carrying it. */
  placeId?: number
  lateOnly?: boolean
  withPlannedLeg?: boolean
  /** Adds the Received (30 days) column. */
  showReceived?: boolean
}

export const shipmentsApi = {
  board: async (query: ShipmentBoardQuery, signal?: AbortSignal) => {
    const board = await request<ShipmentBoardDto>(`${BASE}/board${toQueryString(query)}`, { signal })
    // The selection bar and its dialogs read a card as a container row, whose container no. is null rather than absent.
    for (const card of board.containers) card.containerNo ??= null
    return board
  },
}
