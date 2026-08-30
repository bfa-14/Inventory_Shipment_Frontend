import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { authApi } from '../api/auth'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/Alert'
import { PageHeader } from '../components/layout/PageHeader'

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { logout } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])
    setSuccess(null)

    if (newPassword !== confirmPassword) {
      setErrors(['The new password and its confirmation do not match.'])
      return
    }

    setSubmitting(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      setSuccess('Password changed. All other sessions were signed out - please sign in again.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // The API revoked every refresh token; a clean re-login avoids surprises.
      window.setTimeout(async () => {
        await logout()
        navigate('/login', { replace: true })
      }, 2500)
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The password could not be changed.'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Change password"
        subtitle="At least 8 characters with upper and lower case, a digit and a symbol."
      />

      <section className="card card--narrow">
        <form onSubmit={handleSubmit} noValidate className="form-grid">
          <label htmlFor="currentPassword">Current password</label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />

          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <Alert kind="error" messages={errors} />
          <Alert kind="success" messages={success} />

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Change password'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
