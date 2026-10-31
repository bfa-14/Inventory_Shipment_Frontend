/*
 * Unit tests of src/components/transfers/transferTrackingStore.ts (script 93): the Dispatch dialog's typed rows kept
 * through a reload. `window.sessionStorage` is a small in-memory stand-in (Node has no window).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { serialEntry, type TrackingEntry } from '../../src/components/tracking/trackingNumbers.ts'
import {
  clearStoredTracking,
  readStoredTracking,
  trackingStoreKey,
  writeStoredTracking,
} from '../../src/components/transfers/transferTrackingStore.ts'

class MemoryStorage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

const storage = new MemoryStorage()
;(globalThis as unknown as { window: { sessionStorage: MemoryStorage } }).window = { sessionStorage: storage }

test('a row key is never stored, and every row read back gets a fresh one', () => {
  const typed = [serialEntry('MD626AE1XR1T00001'), serialEntry('MD626AE1XR1T00002')]
  writeStoredTracking(7, 'AAAA', { 11: typed })
  const raw = storage.getItem(trackingStoreKey(7, 'AAAA')) ?? ''
  assert.equal(raw.includes('"key"'), false)

  const restored = readStoredTracking(7, 'AAAA')
  assert.ok(restored)
  const rows = restored[11] ?? []
  assert.deepEqual(
    rows.map((r) => r.serialNo),
    ['MD626AE1XR1T00001', 'MD626AE1XR1T00002'],
  )
  // the reload's page makes its next rows with its own counter: no restored row shares a key with them
  const added: TrackingEntry = serialEntry('MD626AE1XR1T00003')
  const keys = [...rows, added].map((r) => r.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(
    keys.some((k) => typed.some((t) => t.key === k)),
    false,
  )
})

test('restore, then add a row and remove it: only that row goes', () => {
  writeStoredTracking(8, 'BBBB', { 21: [serialEntry('A1'), serialEntry('A2')] })
  const rows = readStoredTracking(8, 'BBBB')?.[21] ?? []
  const added = serialEntry('A3')
  const list = [...rows, added]
  const afterRemove = list.filter((x) => x.key !== added.key)
  assert.deepEqual(
    afterRemove.map((r) => r.serialNo),
    ['A1', 'A2'],
  )
})

test('another row version of the order keeps nothing, and clear removes the order', () => {
  writeStoredTracking(9, 'OLD', { 31: [serialEntry('B1')] })
  assert.equal(readStoredTracking(9, 'NEW'), null)
  assert.equal(storage.getItem(trackingStoreKey(9, 'OLD')), null, 'the older version is dropped on the way')
  writeStoredTracking(9, 'NEW', { 31: [serialEntry('B2')] })
  clearStoredTracking(9)
  assert.equal(readStoredTracking(9, 'NEW'), null)
  writeStoredTracking(9, 'NEW', { 31: [] })
  assert.equal(storage.getItem(trackingStoreKey(9, 'NEW')), null, 'no rows: no key')
})
