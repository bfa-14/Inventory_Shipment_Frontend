interface AlertProps {
  kind: 'error' | 'info' | 'success'
  messages: string[] | string | null | undefined
}

/**
 * Inline notice used by the customer-approved sign-in screen, which is deliberately kept off
 * Mantine. Everywhere else use Mantine's <Alert> or notify().
 */
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
