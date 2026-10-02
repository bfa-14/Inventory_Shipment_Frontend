import { request } from './http'

/**
 * Settings > Email: the mail server, the sender and the address of the application used in the links of
 * the emails. Needs `settings.email.manage`.
 *
 * THE PASSWORD GOES ONE WAY. It is sent when typed and never comes back: the server answers whether one is
 * saved (`hasPassword`) and whether it can still be read (`passwordUnreadable`), nothing more.
 */
const BASE = '/api/settings/email'

/** 0 none, 1 STARTTLS, 2 SSL/TLS. */
export type SmtpSecurity = 0 | 1 | 2

export interface EmailSettingsDto {
  /** False until the page is saved once: nothing is sent before. */
  isSaved: boolean
  sendingEnabled: boolean
  smtpHost: string | null
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUserName: string | null
  hasPassword: boolean
  /** A password is saved but the keys that encrypted it are gone: it must be typed again. */
  passwordUnreadable: boolean
  fromAddress: string | null
  fromName: string | null
  replyToAddress: string | null
  /** The address typed on this page (may be empty). */
  publicBaseUrl: string | null
  /** The address the links really use: this page's, else the configuration file's. */
  effectivePublicBaseUrl: string | null
  lastTestAtUtc: string | null
  lastTestOk: boolean | null
  lastTestError: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
}

/** The fields of the form that describe a mail server: what a save stores and what a test tries. */
export interface EmailSettingsValues {
  sendingEnabled: boolean
  smtpHost: string | null
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUserName: string | null
  /** Typed in the form; null keeps (or, for a test, uses) the saved password. */
  password: string | null
  fromAddress: string | null
  fromName: string | null
  replyToAddress: string | null
  publicBaseUrl: string | null
}

export interface SaveEmailSettingsRequest extends EmailSettingsValues {
  removePassword: boolean
  rowVersion: string | null
}

export interface EmailTestResultDto {
  ok: boolean
  /** Readable: what to check. Null when it worked. */
  error: string | null
  durationMs: number
  /** Recording the result changes the settings row: the next save needs this version. */
  rowVersion: string
}

export const emailSettingsApi = {
  get: (signal?: AbortSignal) => request<EmailSettingsDto>(BASE, { signal }),

  /** 400 VALIDATION with the server's message; 409 when someone else saved meanwhile. */
  save: (payload: SaveEmailSettingsRequest) => request<EmailSettingsDto>(BASE, { method: 'PUT', body: payload }),

  /** Sends one email at once with the values given (or, without them, the saved settings). A refusal is `ok: false`. */
  test: (to: string, values?: EmailSettingsValues) =>
    request<EmailTestResultDto>(`${BASE}/test`, { method: 'POST', body: { to, values: values ?? null } }),
}
