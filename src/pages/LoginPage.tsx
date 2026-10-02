import { useState, type FormEvent } from 'react'
import { Alert, Button, PasswordInput, TextInput } from '@mantine/core'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../api/http'
import { bikeWatermark, katangaLogo, loginHero } from '../assets'
import { safeReturnUrl } from '../auth/returnUrl'
import { useAuth } from '../auth/useAuth'
import { landingRoute } from '../navigation'

/*
 * The controls are Mantine; the LOOK is still the customer-approved design in index.css.
 * Every rule that decides how this screen appears - the 52px fields, the 46px icon gutter, the navy
 * focus ring, the uppercase submit - lives under .login-field / .login-input / .login-submit /
 * .login-alert there, and main.tsx loads index.css AFTER @mantine/core/styles.css, so those rules
 * win the specificity ties against Mantine's own. Restyle the screen there, not here.
 */

export function LoginPage() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Honour the page the user was sent away from (?returnUrl=, a path of this site only - anything else
  // is the home page); without one, land on Users when allowed.
  const returnUrl = searchParams.get('returnUrl')
  const requested = returnUrl === null ? undefined : safeReturnUrl(returnUrl)

  if (status === 'authenticated') {
    return <Navigate to={requested ?? landingRoute(user?.permissions)} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])

    const identifier = username.trim()

    /* TRIMMED BECAUSE A PASTED PASSWORD USUALLY ARRIVES WITH A SPACE ON IT - out of an e-mail, a
       chat message, a spreadsheet cell - and the sign-in that follows fails while showing the
       reader a field that looks exactly right. Nothing sign-innable is lost: the password policy
       refuses to store one that begins or ends with a space, so a trimmed password and the stored
       one can only differ by characters that could never have been saved. */
    const secret = password.trim()

    if (!identifier || !secret) {
      setErrors(['Please enter your username and password.'])
      return
    }

    setSubmitting(true)
    try {
      const signedIn = await login(identifier, secret)
      navigate(requested ?? landingRoute(signedIn.permissions), { replace: true })
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['Sign-in failed. Please try again.'])
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* The picture already contains the TVS logo, the headline and the paragraph - nothing is drawn over it. */}
        <img className="login-hero" src={loginHero} alt="Katanga TVS - powering progress in every mile" />

        <section className="login-panel">
          <img className="login-panel__watermark" src={bikeWatermark} alt="" aria-hidden="true" />

          <div className="login-panel__body">
            <img className="login-panel__logo" src={katangaLogo} alt="Katanga TVS Motor Company" />
            <h1 className="login-panel__title">Welcome Back</h1>
            <p className="login-panel__subtitle">Sign in to continue to Katanga TVS System</p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              {/* The labels stay hand-written rather than Mantine's `label` prop: the design places
                  them above the field at its own size and weight, and Mantine's would also add the
                  required asterisk this screen does not show. */}
              <label className="login-form__label" htmlFor="username">
                Username
              </label>
              <TextInput
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                disabled={submitting}
                leftSection={<UserIcon />}
                leftSectionWidth={46}
                leftSectionPointerEvents="none"
                classNames={{ root: 'login-field', input: 'login-input' }}
              />

              <label className="login-form__label" htmlFor="password">
                Password
              </label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                disabled={submitting}
                leftSection={<LockIcon />}
                leftSectionWidth={46}
                leftSectionPointerEvents="none"
                /* Mantine owns the reveal toggle now, but it keeps THIS screen's eye glyph and its
                   state stays lifted, so nothing about the behaviour changed. */
                visible={showPassword}
                onVisibilityChange={setShowPassword}
                visibilityToggleIcon={({ reveal }) => <EyeIcon off={reveal} />}
                /* Mantine already disables the toggle from the input's own `disabled`; only the
                   label needs saying, because its default is a generic "Toggle password visibility". */
                visibilityToggleButtonProps={{ 'aria-label': showPassword ? 'Hide password' : 'Show password' }}
                classNames={{ root: 'login-field login-field--password', input: 'login-input' }}
              />

              {errors.length > 0 ? (
                <Alert color="red" variant="light" role="alert" classNames={{ root: 'login-alert' }}>
                  {errors.length === 1 ? (
                    errors[0]
                  ) : (
                    <ul>
                      {errors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  )}
                </Alert>
              ) : null}

              <Button type="submit" fullWidth className="login-submit" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </div>

          <footer className="login-footer">
            <p>&copy; {new Date().getFullYear()} Katanga TVS Motor Company. All rights reserved.</p>
            <p>
              Powered by <strong>MAY solutions</strong>
            </p>
            <p>
              Inspired by <strong>Mr. Issa Awada</strong>
            </p>
          </footer>
        </section>
      </div>
    </div>
  )
}

function UserIcon() {
  return (
    <svg
      className="login-field__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 19.5c0-3.6 3.2-5.7 7.2-5.7s7.2 2.1 7.2 5.7" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      className="login-field__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="4.8" y="10.4" width="14.4" height="9.2" rx="2.2" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 1 1 7.2 0v2.6" strokeLinecap="round" />
    </svg>
  )
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="m4 20 16-16" strokeLinecap="round" /> : null}
    </svg>
  )
}
