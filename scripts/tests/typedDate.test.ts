/*
 * Unit tests of src/components/typedDate.ts: the short dates finished when a field is left (a day alone, a day and a
 * month) and the month end a Date From gives Date To. Run with `npm test`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { completeTypedDate, monthEnd, parseTypedDate } from '../../src/components/typedDate.ts'

const today = new Date(2026, 10, 4) // 4 November 2026, local

test('a day alone takes the current month and year', () => {
  assert.equal(completeTypedDate('5', today), '2026-11-05')
  assert.equal(completeTypedDate('05', today), '2026-11-05')
  assert.equal(completeTypedDate(' 30 ', today), '2026-11-30')
})

test('a day the current month does not have is refused', () => {
  assert.equal(completeTypedDate('31', today), null)
  assert.equal(completeTypedDate('0', today), null)
  assert.equal(completeTypedDate('45', today), null)
})

test('a day and a month take the current year', () => {
  assert.equal(completeTypedDate('5/10', today), '2026-10-05')
  assert.equal(completeTypedDate('5/10/', today), '2026-10-05')
  assert.equal(completeTypedDate('05.02', today), '2026-02-05')
  assert.equal(completeTypedDate('5 oct', today), '2026-10-05')
  assert.equal(completeTypedDate('29/02', today), null)
  assert.equal(completeTypedDate('5/13', today), null)
})

test('anything else is left to the parser', () => {
  assert.equal(completeTypedDate('', today), null)
  assert.equal(completeTypedDate('05/10/2026', today), null)
  assert.equal(completeTypedDate('abc', today), null)
  // A day alone is still never a date while typing: it is the start of a longer text.
  assert.equal(parseTypedDate('5'), null)
})

test('month end', () => {
  assert.equal(monthEnd('2026-02-10'), '2026-02-28')
  assert.equal(monthEnd('2028-02-01'), '2028-02-29')
  assert.equal(monthEnd('2026-11-04'), '2026-11-30')
  assert.equal(monthEnd('2026-12-31'), '2026-12-31')
  assert.equal(monthEnd('2026-09-09T00:00:00'), '2026-09-30')
})
