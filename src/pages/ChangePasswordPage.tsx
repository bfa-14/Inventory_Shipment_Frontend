import { useState } from 'react'
import { Alert, Button, Group, Paper, PasswordInput, Stack } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useNavigate } from 'react-router'
import { authApi } from '../api/auth'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/useAuth'
import { PageHeader } from '../components/ui/PageHeader'

const PASSWORD_HINT = 'At least 8 characters with upper and lower case, a digit and a symbol.'

export function ChangePasswordPage() {
  const [errors, setErrors] = useState<string[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { logout } = useAuth()
  const navigate = useNavigate()

  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validate: {
      currentPassword: (value) => (value ? null : 'Enter your current password.'),
      newPassword: (value) => (value ? null : 'Enter a new password.'),
      confirmPassword: (value, values) =>
        value === values.newPassword ? null : 'The new password and its confirmation do not match.',
    },
  })

  async function handleSubmit(values: typeof form.values) {
    setErrors([])
    setSuccess(null)
    setSubmitting(true)

    try {
      await authApi.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword })
      setSuccess('Password changed. All other sessions were signed out - please sign in again.')
      form.reset()
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
      <PageHeader title="Change password" subtitle={PASSWORD_HINT} />

      <Paper radius="lg" p="lg" withBorder maw={480}>
        <form onSubmit={form.onSubmit((values) => void handleSubmit(values))} noValidate>
          <Stack gap="md">
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              withAsterisk
              {...form.getInputProps('currentPassword')}
            />
            <PasswordInput
              label="New password"
              description={PASSWORD_HINT}
              autoComplete="new-password"
              withAsterisk
              {...form.getInputProps('newPassword')}
            />
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              withAsterisk
              {...form.getInputProps('confirmPassword')}
            />

            {errors.length > 0 ? (
              <Alert color="red">{errors.join(' ')}</Alert>
            ) : null}
            {success ? <Alert color="green">{success}</Alert> : null}

            <Group justify="flex-end">
              <Button type="submit" loading={submitting}>
                Change password
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </>
  )
}
