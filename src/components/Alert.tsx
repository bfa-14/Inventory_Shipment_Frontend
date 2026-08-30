interface AlertProps {
  kind: 'error' | 'info' | 'success'
  messages: string[] | string | null | undefined
}

/** Inline notice; renders nothing when there is no message. */
export function Alert({ kind, messages }: AlertProps) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter((m): m is string => !!m)
  if (list.length === 0) return null

  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {list.length === 1 ? (
        list[0]
      ) : (
        <ul>
          {list.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
