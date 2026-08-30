import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/http'
import { bikeWatermark, katangaLogo, loginHero } from '../assets'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/Alert'
import { landingRoute } from '../navigation'

export function LoginPage() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Honour the page the user was sent away from; otherwise land on Users when allowed.
  const requested = (location.state as { from?: string } | null)?.from

  if (status === 'authenticated') {
    return <Navigate to={requested ?? landingRoute(user?.permissions)} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])

    const identifier = username.trim()
    if (!identifier || !password) {
      setErrors(['Please enter your username and password.'])
      return
    }

    setSubmitting(true)
    try {
      const signedIn = await login(identifier, password)
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
              <label className="login-form__label" htmlFor="username">
                Username
              </label>
              <div className="login-field">
                <UserIcon />
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <label className="login-form__label" htmlFor="password">
                Password
              </label>
              <div className="login-field login-field--password">
                <LockIcon />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="login-field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  disabled={submitting}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>

              <Alert kind="error" messages={errors} />

              <button type="submit" className="login-submit" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
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
