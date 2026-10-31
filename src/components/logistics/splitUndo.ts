import type { MovementDto } from '../../api/logistics/movements'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

/** How many containers the sentence names before "and N more". */
const NAMED = 5

/** "KTG-2026-0030", "KTG-2026-0030 and KTG-2026-0031", "KTG-1, KTG-2 and KTG-3", "KTG-1, …, KTG-5 and 9 more". */
function refsPhrase(refs: string[]): string {
  if (refs.length > NAMED) return `${refs.slice(0, NAMED).join(', ')} and ${formatNumber(refs.length - NAMED)} more`
  return refs.length <= 1 ? (refs[0] ?? '') : `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}`
}

/**
 * What a completed movement did, with the movement as the subject, and what that means for the containers put back on
 * it ("which arrived at Dar es Salaam on 17/10/2026: they arrive with it") - by the stage of its type.
 */
function completedWords(stage: string | null | undefined, toName: string, subject: string, one: boolean): { did: string; then: string } {
  const s = (plural: string, singular: string) => (one ? singular : plural)
  switch (stage) {
    case 'Customs':
      return { did: `cleared customs at ${toName}`, then: `${subject} ${s('are', 'is')} cleared with it` }
    case 'Border':
      return { did: `crossed the border at ${toName}`, then: `${subject} ${s('cross', 'crosses')} with it` }
    case 'Port':
      return { did: `left the port of ${toName}`, then: `${subject} ${s('leave', 'leaves')} with it` }
    case 'Origin':
      return { did: `ended at ${toName}`, then: `${subject} ${s('are', 'is')} loaded with it` }
    case 'Delivery':
      return {
        did: `reached ${toName}`,
        then: `${subject} ${s('are', 'is')} delivered with it, without a draft goods receipt. Use Receive goods… on ${s('each container', 'it')}`,
      }
    default:
      return { did: `arrived at ${toName}`, then: `${subject} ${s('arrive', 'arrives')} with it` }
  }
}

/**
 * (82) THE CANCEL DIALOG OF A SPLIT-OFF MOVEMENT SAYS FIRST WHAT CANCELLING IT DOES: it undoes the split, so its containers
 * go back onto the movement they were split from (the server's `splitUndo…`, which also follows a parent cancelled
 * before), whatever that one's status - "Cancelling MOV-2026-000073 puts KTG-2026-0030 and KTG-2026-0031 back on
 * MOV-2026-000044, which is still in progress." / "…, which arrived at Dar es Salaam on 17/10/2026: they arrive with it." /
 * "…, which is cancelled: they go back to where they were before it." Null for a movement that was not split off, or that
 * has no container left to put back.
 */
export function splitUndoText(movement: MovementDto): string | null {
  if (!movement.splitUndoMovementNo || movement.status === 4 || movement.containers.length === 0) return null
  const refs = movement.containers.map((c) => c.containerRef)
  const one = refs.length === 1
  const head = `Cancelling ${movement.movementNo} puts ${refsPhrase(refs)} back on ${movement.splitUndoMovementNo}`
  if (movement.splitUndoStatus === 2) return `${head}, which is still in progress.`
  if (movement.splitUndoStatus === 3) {
    const words = completedWords(movement.splitUndoStage, movement.splitUndoToName ?? 'its To', one ? refs[0] : 'they', one)
    return `${head}, which ${words.did} on ${dateLabel(movement.splitUndoEndDate)}: ${words.then}.`
  }
  return `${head}, which is cancelled: ${one ? 'it goes' : 'they go'} back to where ${one ? 'it was' : 'they were'} before it.`
}
