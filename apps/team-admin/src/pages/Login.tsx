/** The sign-in card: the only view a browser with no session can reach. */

import { useState, type ReactNode } from 'react'
import { Button, Card, Form, Input, Typography } from 'antd'
import { api, ApiError, holdCsrf, type WireSession } from '../api.ts'
import { useLocale } from '../locale.tsx'

/** What the form collects. */
interface Credentials {
  loginName: string
  secret: string
}

/**
 * Ask for a member name and password.
 * @param props.onSignedIn - receives the session the Control Plane opened.
 * @returns the sign-in view.
 */
export function Login({ onSignedIn }: { readonly onSignedIn: (session: WireSession) => void }): ReactNode {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const submit = async (values: Credentials): Promise<void> => {
    setBusy(true)
    setProblem(undefined)
    try {
      const session = await api.signIn(values.loginName, values.secret)
      holdCsrf(session.csrf)
      onSignedIn(session)
    } catch (error) {
      // One message for every cause, which is what the Control Plane answers:
      // saying which half was wrong is exactly what an attacker wants.
      setProblem(error instanceof ApiError && error.error === 'unavailable'
        ? t('error.unavailable')
        : t('error.signIn'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <Card className="auth-card" variant="borderless">
        <div className="brand-mark">DS</div>
        <Typography.Text className="eyebrow">{t('login.eyebrow')}</Typography.Text>
        <Typography.Title level={2} style={{ marginTop: 8 }}>{t('login.heading')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('login.kicker')}</Typography.Paragraph>
        <Form<Credentials> layout="vertical" onFinish={values => void submit(values)} requiredMark={false}>
          <Form.Item
            name="loginName"
            label={t('login.member')}
            rules={[{ required: true, message: t('login.required') }]}
          >
            <Input size="large" autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="secret"
            label={t('login.password')}
            rules={[{ required: true, message: t('login.required') }]}
            {...(problem === undefined ? {} : { validateStatus: 'error' as const, help: problem })}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" loading={busy} block>
            {t('login.submit')}
          </Button>
        </Form>
      </Card>
    </div>
  )
}
