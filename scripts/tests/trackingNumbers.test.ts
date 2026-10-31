/*
 * Unit tests of src/components/tracking/trackingNumbers.ts (script 93): the three pasted shapes, the normalising rule
 * and the mirrors of the database's sentences. Run with `npm test` (Node's own runner, which strips the types: no
 * dependency). Outside src/, so the app's tsconfig (DOM, Vite) never sees node:test.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyText,
  entriesComplete,
  entriesStateText,
  incompleteSentence,
  mergeReceiptTracking,
  normalizeTrackingNo,
  parsePastedRows,
  parsePastedSerials,
  quantityEntry,
  receiptStateText,
  receiptTotals,
  serialEntry,
  trackingKindOf,
  trackingSummary,
} from '../../src/components/tracking/trackingNumbers.ts'

test('normalizeTrackingNo trims tab, CR, LF, NBSP, BOM and spaces at both ends only, in capitals', () => {
  assert.equal(normalizeTrackingNo('  md626ae1xr1t00001\r'), 'MD626AE1XR1T00001')
  assert.equal(normalizeTrackingNo('﻿ B2410-07\t\n'), 'B2410-07')
  // One inside stays: the server refuses it with its own sentence.
  assert.equal(normalizeTrackingNo('A\tB'), 'A\tB')
  assert.equal(normalizeTrackingNo('lot 7'), 'LOT 7')
  assert.equal(normalizeTrackingNo(' \t '), null)
  assert.equal(normalizeTrackingNo(null), null)
})

test('trackingKindOf is K(i)', () => {
  assert.equal(trackingKindOf('Serial', false), 'Serial')
  assert.equal(trackingKindOf('Serial', true), 'Serial')
  assert.equal(trackingKindOf('Batch', true), 'Batch')
  assert.equal(trackingKindOf('None', true), 'Expiry')
  assert.equal(trackingKindOf('None', false), null)
  assert.equal(trackingKindOf(undefined, undefined), null)
})

test('shape 1: serial numbers, one per line or joined by commas, semicolons or spaces', () => {
  const result = parsePastedSerials('md626ae1xr1t00001\nMD626AE1XR1T00002, MD626AE1XR1T00003;MD626AE1XR1T00004\r\n\n  00005 00006 ', false)
  assert.deepEqual(
    result.rows.map((r) => r.serialNo),
    ['MD626AE1XR1T00001', 'MD626AE1XR1T00002', 'MD626AE1XR1T00003', 'MD626AE1XR1T00004', '00005', '00006'],
  )
  assert.equal(result.unread.length, 0)
  assert.equal(result.missingExpiry, 0)
  assert.ok(result.rows.every((r) => r.expiryDate === null))
})

test('shape 1 with expiry: a date follows its serial, read day first', () => {
  const result = parsePastedSerials('S1\t31/03/2027\nS2 2027-06-30\nS3\n31/02/2027 S4\nS5 31/02/2027', true)
  assert.deepEqual(result.rows, [
    { serialNo: 'S1', expiryDate: '2027-03-31' },
    { serialNo: 'S2', expiryDate: '2027-06-30' },
    { serialNo: 'S3', expiryDate: null },
  ])
  assert.equal(result.missingExpiry, 1)
  // A date before any serial, and a date that does not exist: the whole line is unread.
  assert.deepEqual(result.unread, [
    { lineNumber: 4, text: '31/02/2027 S4' },
    { lineNumber: 5, text: 'S5 31/02/2027' },
  ])
})

test('shape 1 without expiry: a date is never taken for a serial', () => {
  const result = parsePastedSerials('S1 31/03/2027', false)
  assert.equal(result.rows.length, 0)
  assert.deepEqual(result.unread, [{ lineNumber: 1, text: 'S1 31/03/2027' }])
})

test('shape 2: batch rows, batch | expiry | pcs or batch | pcs, cells by tab, semicolon or comma', () => {
  const result = parsePastedRows('b2410-07\t31/03/2027\t40\nB2411-02;30/06/2027;20\nLOT 7, 5\nB9\t\t3\nB10\t31/03/2027\nB11\tx\t4\nB12\t0', 'Batch', true)
  assert.deepEqual(result.rows, [
    { batchNo: 'B2410-07', expiryDate: '2027-03-31', quantity: 40 },
    { batchNo: 'B2411-02', expiryDate: '2027-06-30', quantity: 20 },
    { batchNo: 'LOT 7', expiryDate: null, quantity: 5 },
    // An empty Excel cell between: batch | pcs.
    { batchNo: 'B9', expiryDate: null, quantity: 3 },
  ])
  assert.equal(result.missingExpiry, 2)
  // No readable whole number of pcs above 0, or a date that is not one: unread.
  assert.deepEqual(
    result.unread.map((u) => u.lineNumber),
    [5, 6, 7],
  )
})

test('shape 3: expiry rows, expiry | pcs', () => {
  const result = parsePastedRows('31/01/2027\t20\n28/02/2027;10\n2027-03-31,5\n31/01/2027\n29/02/2027\t1\nfoo\t2', 'Expiry', true)
  assert.deepEqual(result.rows, [
    { batchNo: null, expiryDate: '2027-01-31', quantity: 20 },
    { batchNo: null, expiryDate: '2027-02-28', quantity: 10 },
    { batchNo: null, expiryDate: '2027-03-31', quantity: 5 },
  ])
  assert.deepEqual(
    result.unread.map((u) => u.lineNumber),
    [4, 5, 6],
  )
})

test('the mirrors of Seq 12 and 24 say what the database says', () => {
  const p = 'Line 1 (TEST93-S)'
  assert.equal(
    incompleteSentence('Serial', p, [], 20),
    'Line 1 (TEST93-S): type the serial numbers of the 20 pcs that leave (Serial nos.…).',
  )
  const nineteen = Array.from({ length: 19 }, (_, i) => serialEntry(`S${i}`))
  assert.equal(incompleteSentence('Serial', p, nineteen, 20), 'Line 1 (TEST93-S): 20 pcs leave but 19 serial numbers are typed.')
  assert.equal(incompleteSentence('Serial', p, nineteen, 19), null)
  assert.equal(
    incompleteSentence('Batch', 'Line 2 (TEST93-B)', [quantityEntry('B1', null, 40), quantityEntry('B2', null, 19)], 60),
    'Line 2 (TEST93-B): the batches add up to 59 pcs but 60 pcs leave.',
  )
  assert.equal(
    incompleteSentence('Expiry', 'Line 3 (TEST93-E)', [], 30),
    'Line 3 (TEST93-E): give the expiry dates of the 30 pcs (Expiry dates…).',
  )
  assert.equal(incompleteSentence('Batch', p, [], 0), null)
})

test('the line state and the receipt summary', () => {
  const batches = [quantityEntry('B1', '2027-03-31', 40), quantityEntry('B2', '2027-06-30', 15)]
  assert.equal(entriesStateText('Batch', batches, 60), '55 / 60 pcs in 2 batches')
  assert.equal(entriesComplete('Batch', batches, 60), false)
  assert.equal(entriesComplete('Batch', batches, 55), true)
  assert.equal(entriesStateText('Serial', [serialEntry('A')], 1), '1 / 1 serial nos.')

  const rows = [
    { id: 1, rowNumber: 1, serialNo: 'A', batchNo: null, expiryDate: null, onTheWay: 1, received: 1, rest: 'coming' as const },
    { id: 2, rowNumber: 2, serialNo: 'B', batchNo: null, expiryDate: null, onTheWay: 1, received: 0, rest: 'lost' as const },
    { id: 3, rowNumber: 3, serialNo: 'C', batchNo: null, expiryDate: null, onTheWay: 1, received: 0, rest: 'coming' as const },
  ]
  assert.deepEqual(receiptTotals(rows), { arrived: 1, lost: 1, coming: 1 })
  assert.equal(receiptStateText(receiptTotals(rows)), '1 arrived · 1 lost · 1 still coming')
  assert.equal(receiptStateText({ arrived: 18, lost: 0, coming: 2 }), '18 arrived · 2 still coming')
})

test('Copy list gives back what Paste list reads', () => {
  const view = [
    { key: 1, rowNumber: 1, serialNo: null, batchNo: 'B2410-07', expiryDate: '2027-03-31', quantity: 40, lost: 0, state: 'OnTheWay', stateText: '' },
    { key: 2, rowNumber: 2, serialNo: null, batchNo: 'LOT 7', expiryDate: null, quantity: 5, lost: 0, state: 'OnTheWay', stateText: '' },
  ]
  const back = parsePastedRows(copyText('Batch', view), 'Batch', false)
  assert.deepEqual(back.rows, [
    { batchNo: 'B2410-07', expiryDate: '2027-03-31', quantity: 40 },
    { batchNo: 'LOT 7', expiryDate: null, quantity: 5 },
  ])
  assert.equal(trackingSummary('Serial', true, 17), 'Tracking: Serial numbers (17 characters) · expiry date required')
  assert.equal(trackingSummary('None', false, null), 'Tracking: None')
})

test('the rows on the way read again keep what the reader said of each row still on the way', () => {
  const row = (id: number, onTheWay: number, received: number, rest: 'coming' | 'lost' = 'coming') => ({
    id,
    rowNumber: id,
    serialNo: `S${id}`,
    batchNo: null,
    expiryDate: null,
    onTheWay,
    received,
    rest,
  })
  // first read: the default, nothing said yet, nothing changed
  const first = mergeReceiptTracking(undefined, [row(1, 1, 1), row(2, 1, 1)])
  assert.equal(first.changed, false)
  assert.equal(first.tracking.scanning, false)

  // the reader marked 2 Lost, 3 still coming, in a scan session; someone else received 1 meanwhile
  const said = { entries: [row(1, 1, 1), row(2, 1, 0, 'lost'), row(3, 1, 0)], scanning: true }
  const again = mergeReceiptTracking(said, [row(2, 1, 1), row(3, 1, 1)])
  assert.equal(again.changed, true)
  assert.equal(again.tracking.scanning, true)
  assert.deepEqual(
    again.tracking.entries.map((e) => [e.id, e.received, e.rest]),
    [
      [2, 0, 'lost'],
      [3, 0, 'coming'],
    ],
  )

  // a batch now with less on the way: what was received never goes above it
  const batch = mergeReceiptTracking({ entries: [row(5, 40, 40)], scanning: false }, [row(5, 25, 25)])
  assert.equal(batch.changed, true)
  assert.equal(batch.tracking.entries[0]?.received, 25)

  // the same rows: nothing changed; a row back on the way in a scan session comes unticked
  assert.equal(mergeReceiptTracking(said, [row(1, 1, 1), row(2, 1, 1), row(3, 1, 1)]).changed, false)
  const back = mergeReceiptTracking({ entries: [row(1, 1, 1)], scanning: true }, [row(1, 1, 1), row(4, 1, 1)])
  assert.equal(back.changed, true)
  assert.equal(back.tracking.entries[1]?.received, 0)
})
