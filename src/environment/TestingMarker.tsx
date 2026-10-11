import { useEnvironment } from './useEnvironment'

/**
 * The TESTING marker for the pages that live outside the shell, and so never get its header badge: the
 * print pages (receipt, payment voucher, customer statement, shortage plan) and the emailed approval
 * page. The testing database starts as a copy of production, so without it a receipt printed in testing
 * - real customer, real amounts - would be indistinguishable from a real one.
 *
 * An orange strip at the top of the page, in the flow so it never covers the document, and NOT under
 * .no-print: it goes onto the paper too (styles/app.css keeps its colour when printing). Production, and
 * an environment that could not be read, render nothing.
 */
export function TestingMarker() {
  const { environment } = useEnvironment()
  if (environment !== 'testing') return null

  return (
    <div className="testing-marker" role="note">
      Test environment - test data, not a real document
    </div>
  )
}
