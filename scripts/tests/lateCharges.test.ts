/*
 * Unit tests of src/components/logistics/lateCharges.ts (script 118, prompt 53): the sentence a post confirmation adds
 * for a charge on goods already received, and the late part of a container line's landed cost. Run with `npm test`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { lateChargeSentence, lateChargesByLine, postPreviewProblem, type LateChargePreview } from '../../src/components/logistics/lateCharges.ts'

function preview(p: Partial<LateChargePreview>): LateChargePreview {
  return {
    containerRef: 'KTG-2026-0031', chargeName: 'Handling', afterReceipt: true, receivedBase: 84, inStockBase: 80,
    toStockBase: 2800, toCostOfSalesBase: 140, problem: null, ...p,
  }
}

test('one late charge: where its goods are and how it splits', () => {
  assert.equal(
    lateChargeSentence([preview({})], 'USD'),
    "KTG-2026-0031's goods are received: 84 pcs, 80 of them still in stock. 2,800.00 USD goes to their average cost and 140.00 USD to cost of sales (the pieces already sold).",
  )
})

test('everything still in stock, or everything sold', () => {
  assert.equal(
    lateChargeSentence([preview({ inStockBase: 84, toStockBase: 2940, toCostOfSalesBase: 0 })]),
    "KTG-2026-0031's goods are received: 84 pcs, all of them still in stock. 2,940.00 goes to their average cost.",
  )
  assert.equal(
    lateChargeSentence([preview({ inStockBase: 0, toStockBase: 0, toCostOfSalesBase: 2940 })], 'USD'),
    "KTG-2026-0031's goods are received: 84 pcs, none of them still in stock. 2,940.00 USD goes to cost of sales (the pieces already sold).",
  )
})

test('a deduction comes off', () => {
  assert.equal(
    lateChargeSentence([preview({ receivedBase: 102, inStockBase: 38, toStockBase: -132.84, toCostOfSalesBase: -168.53 })], 'USD'),
    "KTG-2026-0031's goods are received: 102 pcs, 38 of them still in stock. 132.84 USD comes off their average cost and 168.53 USD off cost of sales (the pieces already sold).",
  )
})

test('not late, or refused: no sentence; the refusal is read apart', () => {
  assert.equal(lateChargeSentence([preview({ afterReceipt: false, toStockBase: null, toCostOfSalesBase: null })]), null)
  const refused = preview({ problem: 'Freight on KTG-2026-0031: item TVS-A has no weight (kg).', toStockBase: null, toCostOfSalesBase: null })
  assert.equal(lateChargeSentence([refused]), null)
  assert.equal(postPreviewProblem([preview({}), refused]), 'Freight on KTG-2026-0031: item TVS-A has no weight (kg).')
  assert.equal(postPreviewProblem([preview({})]), null)
})

test('several charges: their totals', () => {
  const before = preview({ afterReceipt: false, containerRef: 'KTG-2026-0040', toStockBase: null, toCostOfSalesBase: null })
  assert.equal(
    lateChargeSentence([preview({}), preview({ containerRef: 'KTG-2026-0032', toStockBase: 200, toCostOfSalesBase: 10 }), before], 'USD'),
    'Of these, 2 are on goods already received (KTG-2026-0031, KTG-2026-0032): 3,000.00 USD goes to their average cost and 150.00 USD to cost of sales (the pieces already sold).',
  )
  assert.equal(
    lateChargeSentence([preview({}), preview({ toStockBase: -3000, toCostOfSalesBase: 10 })]),
    'All 2 are on goods already received (KTG-2026-0031): −200.00 on their average cost and +150.00 on cost of sales (the pieces already sold).',
  )
})

test('the late part per container line: posted charges after the receipt only', () => {
  const charges = [
    { id: 1, status: 2, includeInLandedCost: true, adjustedAfterOffload: false },   // before the receipt
    { id: 2, status: 2, includeInLandedCost: true, adjustedAfterOffload: true },    // late
    { id: 3, status: 3, includeInLandedCost: true, adjustedAfterOffload: true },    // late, cancelled
    { id: 4, status: 2, includeInLandedCost: true, adjustedAfterOffload: true },    // late deduction
    { id: 5, status: 1, includeInLandedCost: true, adjustedAfterOffload: false },   // draft
  ]
  const allocations = [
    { chargeId: 1, containerLineId: 10, amountBase: 2100 },
    { chargeId: 2, containerLineId: 10, amountBase: 411.76 },
    { chargeId: 2, containerLineId: 11, amountBase: 588.24 },
    { chargeId: 3, containerLineId: 10, amountBase: 500 },
    { chargeId: 4, containerLineId: 10, amountBase: -124.08 },
    { chargeId: 5, containerLineId: 11, amountBase: 50 },
  ]
  assert.deepEqual([...lateChargesByLine(charges, allocations)], [[10, 287.68], [11, 588.24]])
})
