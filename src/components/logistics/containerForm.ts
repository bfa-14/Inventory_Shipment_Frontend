import type {
  AvailableInvoiceDto,
  AvailableInvoiceLineDto,
  ContainerDto,
  ContainerInvoiceDto,
  ContainerLineDto,
  SaveContainerRequest,
  ShippingMethod,
} from '../../api/logistics/containers'
import { isoDate } from '../documents/documentKind'

/**
 * The container page's state and the arithmetic on it. Dates are 'YYYY-MM-DD' strings (what the
 * Mantine date inputs hold), numbers the reader may leave empty are `number | ''`.
 */
export interface ContainerFormValues {
  containerNo: string
  containerTypeId: string | null
  sealNo: string
  customsSealNo: string
  description: string
  orderDate: string | null
  shippingMethod: ShippingMethod
  countryOfOrigin: string | null
  forwarderId: string | null
  transporterId: string | null
  shippingLine: string
  vesselName: string
  voyageNo: string
  bookingNo: string
  portOfLoadingId: string | null
  portOfDestinationId: string | null
  finalDestinationId: string | null
  dispatchDate: string | null
  eta: string | null
  freeDays: number | ''
  grossWeightKg: number | ''
  volumeCbm: number | ''
  packages: number | ''
  blNo: string
  blDate: string | null
  blNotes: string
  maxUnits: number | ''
  branchId: string | null
  warehouseId: string | null
  truckNo: string
  waybillNo: string
  declarationNo: string
  feriNo: string
  actualPortArrival: string | null
  borderCrossingDate: string | null
  customsReleaseDate: string | null
  notes: string
}

/** An invoice linked to the container, whichever list it came from. */
export interface LinkedInvoice {
  purchaseDocumentId: number
  documentNumber: string | null
  documentDate: string
  supplierId: number
  supplierName: string
  currencyCode: string
  commercialInvoiceNo: string | null
  exporterReference: string | null
  /** 1 Draft, 2 Posted. The offload wants every invoice posted. */
  invoiceStatus: number
}

/** One loaded line as the page edits it. `maxBase` is the ceiling for THIS container, in base units. */
export interface LoadLine {
  key: string
  /** The saved container line (for the offload); null until saved. */
  lineId: number | null
  purchaseLineId: number
  purchaseDocumentId: number
  invoiceNumber: string | null
  supplierName: string
  itemCode: string
  itemName: string
  model: string | null
  unitTypeName: string
  packingFormula: number
  /** In the purchase unit. */
  quantity: number
  oilIncluded: boolean
  oilQtyPerUnit: number | null
  maxBase: number
  receivedQuantityBase: number | null
  varianceReason: string | null
}

const text = (value: string | null | undefined) => value ?? ''
const id = (value: number | null | undefined) => (value === null || value === undefined ? null : String(value))
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null)
const num = (value: number | null | undefined): number | '' => (value === null || value === undefined ? '' : value)

export function emptyValues(branchId: string | null): ContainerFormValues {
  return {
    containerNo: '',
    containerTypeId: null,
    sealNo: '',
    customsSealNo: '',
    description: '',
    orderDate: isoDate(new Date()),
    shippingMethod: 'Sea',
    countryOfOrigin: null,
    forwarderId: null,
    transporterId: null,
    shippingLine: '',
    vesselName: '',
    voyageNo: '',
    bookingNo: '',
    portOfLoadingId: null,
    portOfDestinationId: null,
    finalDestinationId: null,
    dispatchDate: null,
    eta: null,
    freeDays: '',
    grossWeightKg: '',
    volumeCbm: '',
    packages: '',
    blNo: '',
    blDate: null,
    blNotes: '',
    maxUnits: '',
    branchId,
    warehouseId: null,
    truckNo: '',
    waybillNo: '',
    declarationNo: '',
    feriNo: '',
    actualPortArrival: null,
    borderCrossingDate: null,
    customsReleaseDate: null,
    notes: '',
  }
}

export function toValues(c: ContainerDto): ContainerFormValues {
  return {
    containerNo: text(c.containerNo),
    containerTypeId: id(c.containerTypeId),
    sealNo: text(c.sealNo),
    customsSealNo: text(c.customsSealNo),
    description: text(c.description),
    orderDate: day(c.orderDate),
    shippingMethod: c.shippingMethod,
    countryOfOrigin: c.countryOfOrigin,
    forwarderId: id(c.forwarderId),
    transporterId: id(c.transporterId),
    shippingLine: text(c.shippingLine),
    vesselName: text(c.vesselName),
    voyageNo: text(c.voyageNo),
    bookingNo: text(c.bookingNo),
    portOfLoadingId: id(c.portOfLoadingId),
    portOfDestinationId: id(c.portOfDestinationId),
    finalDestinationId: id(c.finalDestinationId),
    dispatchDate: day(c.dispatchDate),
    eta: day(c.eta),
    freeDays: num(c.freeDays),
    grossWeightKg: num(c.grossWeightKg),
    volumeCbm: num(c.volumeCbm),
    packages: num(c.packages),
    blNo: text(c.blNo),
    blDate: day(c.blDate),
    blNotes: text(c.blNotes),
    maxUnits: num(c.maxUnits),
    branchId: id(c.branchId),
    warehouseId: id(c.warehouseId),
    truckNo: text(c.truckNo),
    waybillNo: text(c.waybillNo),
    declarationNo: text(c.declarationNo),
    feriNo: text(c.feriNo),
    actualPortArrival: day(c.actualPortArrival),
    borderCrossingDate: day(c.borderCrossingDate),
    customsReleaseDate: day(c.customsReleaseDate),
    notes: text(c.notes),
  }
}

export function fromContainerInvoice(i: ContainerInvoiceDto): LinkedInvoice {
  return {
    purchaseDocumentId: i.purchaseDocumentId,
    documentNumber: i.documentNumber,
    documentDate: i.documentDate,
    supplierId: i.supplierId,
    supplierName: i.supplierName,
    currencyCode: i.currencyCode,
    commercialInvoiceNo: i.commercialInvoiceNo,
    exporterReference: i.exporterReference,
    invoiceStatus: i.invoiceStatus,
  }
}

export function fromAvailableInvoice(i: AvailableInvoiceDto): LinkedInvoice {
  return {
    purchaseDocumentId: i.id,
    documentNumber: i.documentNumber,
    documentDate: i.documentDate,
    supplierId: i.supplierId,
    supplierName: i.supplierName,
    currencyCode: i.currencyCode,
    commercialInvoiceNo: i.commercialInvoiceNo,
    exporterReference: i.exporterReference,
    invoiceStatus: i.status,
  }
}

export function fromContainerLine(l: ContainerLineDto): LoadLine {
  return {
    key: `line-${l.id}`,
    lineId: l.id,
    purchaseLineId: l.purchaseLineId,
    purchaseDocumentId: l.purchaseDocumentId,
    invoiceNumber: l.invoiceNumber,
    supplierName: l.supplierName,
    itemCode: l.itemCode,
    itemName: l.itemName,
    model: l.model,
    unitTypeName: l.unitTypeName,
    packingFormula: l.packingFormula,
    quantity: l.quantity,
    oilIncluded: l.oilIncluded,
    oilQtyPerUnit: l.oilQtyPerUnit,
    maxBase: l.availableBase,
    receivedQuantityBase: l.receivedQuantityBase,
    varianceReason: l.varianceReason,
  }
}

export function fromInvoiceLine(
  l: AvailableInvoiceLineDto,
  invoice: LinkedInvoice,
  quantity: number,
  oilIncluded: boolean,
  oilQtyPerUnit: number | null,
): LoadLine {
  return {
    key: `new-${l.purchaseLineId}`,
    lineId: null,
    purchaseLineId: l.purchaseLineId,
    purchaseDocumentId: l.purchaseDocumentId,
    invoiceNumber: invoice.documentNumber,
    supplierName: invoice.supplierName,
    itemCode: l.itemCode,
    itemName: l.itemName,
    model: l.model,
    unitTypeName: l.unitTypeName,
    packingFormula: l.packingFormula,
    quantity,
    oilIncluded,
    oilQtyPerUnit: oilIncluded ? oilQtyPerUnit : null,
    maxBase: l.availableBase,
    receivedQuantityBase: null,
    varianceReason: null,
  }
}

export const lineBase = (line: LoadLine) => line.quantity * line.packingFormula
export const lineOil = (line: LoadLine) => (line.oilIncluded ? line.quantity * (line.oilQtyPerUnit ?? 0) : 0)

export interface Capacity {
  maxUnits: number | null
  allocated: number
  remaining: number | null
  /** 0-100+, null without a capacity. */
  utilization: number | null
  over: boolean
}

export function capacityOf(maxUnits: number | '', lines: LoadLine[]): Capacity {
  const allocated = lines.reduce((sum, line) => sum + lineBase(line), 0)
  const max = maxUnits === '' ? null : maxUnits
  return {
    maxUnits: max,
    allocated,
    remaining: max === null ? null : max - allocated,
    utilization: max ? (allocated * 100) / max : null,
    over: max !== null && allocated > max,
  }
}

/** Port arrival + free days, 'YYYY-MM-DD'; null when either is missing. */
export function lastFreeDay(actualPortArrival: string | null, freeDays: number | ''): string | null {
  if (!actualPortArrival || freeDays === '') return null
  const [year, month, dayOfMonth] = actualPortArrival.split('-').map(Number)
  return isoDate(new Date(year, month - 1, dayOfMonth + Number(freeDays)))
}

/** "Sep-2026" from 'YYYY-MM-DD', as the server writes it. */
export function orderMonthLabel(orderDate: string | null): string {
  if (!orderDate) return '—'
  const [year, month] = orderDate.split('-').map(Number)
  const name = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' })
  return `${name}-${year}`
}

const optionalText = (value: string) => (value.trim() ? value.trim() : null)
const optionalId = (value: string | null) => (value === null ? null : Number(value))
const optionalNumber = (value: number | '') => (value === '' ? null : Number(value))

export function toRequest(
  values: ContainerFormValues,
  invoices: LinkedInvoice[],
  lines: LoadLine[],
  allowOverCapacity: boolean,
  rowVersion: string | null,
  /** The server's note ("Offload reversed: ...") is kept, not typed. */
  statusNote: string | null,
): SaveContainerRequest {
  return {
    containerNo: optionalText(values.containerNo)?.toUpperCase() ?? null,
    containerTypeId: Number(values.containerTypeId),
    sealNo: optionalText(values.sealNo),
    customsSealNo: optionalText(values.customsSealNo),
    description: optionalText(values.description),
    orderDate: values.orderDate as string,
    shippingMethod: values.shippingMethod,
    countryOfOrigin: values.countryOfOrigin,
    forwarderId: optionalId(values.forwarderId),
    transporterId: optionalId(values.transporterId),
    shippingLine: optionalText(values.shippingLine),
    vesselName: optionalText(values.vesselName),
    voyageNo: optionalText(values.voyageNo),
    bookingNo: optionalText(values.bookingNo),
    portOfLoadingId: optionalId(values.portOfLoadingId),
    portOfDestinationId: optionalId(values.portOfDestinationId),
    finalDestinationId: optionalId(values.finalDestinationId),
    dispatchDate: values.dispatchDate,
    eta: values.eta,
    freeDays: optionalNumber(values.freeDays),
    grossWeightKg: optionalNumber(values.grossWeightKg),
    volumeCbm: optionalNumber(values.volumeCbm),
    packages: optionalNumber(values.packages),
    blNo: optionalText(values.blNo),
    blDate: values.blDate,
    blNotes: optionalText(values.blNotes),
    maxUnits: optionalNumber(values.maxUnits),
    branchId: Number(values.branchId),
    warehouseId: optionalId(values.warehouseId),
    truckNo: optionalText(values.truckNo),
    waybillNo: optionalText(values.waybillNo),
    declarationNo: optionalText(values.declarationNo),
    feriNo: optionalText(values.feriNo),
    actualPortArrival: values.actualPortArrival,
    borderCrossingDate: values.borderCrossingDate,
    customsReleaseDate: values.customsReleaseDate,
    statusNote,
    notes: optionalText(values.notes),
    invoices: invoices.map((i) => i.purchaseDocumentId),
    lines: lines.map((line) => ({
      purchaseLineId: line.purchaseLineId,
      quantity: line.quantity,
      oilIncluded: line.oilIncluded,
      oilQtyPerUnit: line.oilIncluded ? line.oilQtyPerUnit : null,
      notes: null,
    })),
    allowOverCapacity,
    rowVersion,
  }
}
