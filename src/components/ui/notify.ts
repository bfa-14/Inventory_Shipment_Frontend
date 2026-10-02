import { notifications } from '@mantine/notifications'

const AUTO_CLOSE = 4000

/**
 * Transient feedback after a successful action. Errors that belong to a field stay in the form;
 * notify.error is for failures with nowhere better to go.
 */
export const notify = {
  success(message: string) {
    notifications.show({ message, color: 'green', autoClose: AUTO_CLOSE, withBorder: true })
  },

  error(message: string) {
    notifications.show({ message, color: 'red', autoClose: AUTO_CLOSE, withBorder: true })
  },

  info(message: string) {
    notifications.show({ message, color: 'blue', autoClose: AUTO_CLOSE, withBorder: true })
  },

  /** Done, but with something the reader has to know: the supplier was not emailed, say. Stays longer. */
  warning(message: string) {
    notifications.show({ message, color: 'orange', autoClose: AUTO_CLOSE * 2, withBorder: true })
  },
}
