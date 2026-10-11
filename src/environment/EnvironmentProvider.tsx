import { useEffect, useState, type ReactNode } from 'react'
import { EnvironmentContext } from './EnvironmentContext'
import { loadEnvironment, TESTING_TITLE_PREFIX, UNKNOWN_ENVIRONMENT, type EnvironmentInfo } from './environment'

/**
 * Reads /environment.json once (see environment.ts) and hands the answer to every screen through
 * useEnvironment(). The children render straight away with "unknown"; the answer re-renders them when
 * it arrives, which is a few milliseconds after the page itself.
 *
 * In the testing environment it also marks the browser tab: "TEST · " in front of the title.
 */
export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<EnvironmentInfo>(UNKNOWN_ENVIRONMENT)

  useEffect(() => {
    let active = true
    void loadEnvironment().then((loaded) => {
      if (active) setInfo(loaded)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (info.environment !== 'testing') return

    // A page that sets its own title (document.title, or a <title> React 19 hoists into <head>) would
    // otherwise wipe the marker, so the head is watched and the prefix put back. Only ever added when
    // missing: the change this makes fires the observer once more, and that call finds nothing to do.
    const mark = () => {
      if (!document.title.startsWith(TESTING_TITLE_PREFIX)) document.title = TESTING_TITLE_PREFIX + document.title
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (document.title.startsWith(TESTING_TITLE_PREFIX)) {
        document.title = document.title.slice(TESTING_TITLE_PREFIX.length)
      }
    }
  }, [info.environment])

  return <EnvironmentContext.Provider value={info}>{children}</EnvironmentContext.Provider>
}
