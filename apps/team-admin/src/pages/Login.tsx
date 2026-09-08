/** The sign-in card: the only view a browser with no session can reach. */

import { useState, type ReactNode } from 'react'
import { Button, Card, Form, Input } from 'antd'
import { api, ApiError, holdCsrf, type WireSession } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { WELINKIN_LOGO_HEIGHT, WELINKIN_LOGO_SOURCE, WELINKIN_LOGO_WIDTH } from '../brand.ts'

/** Width the lockup draws the mark at, in px; the Runner's page draws the same. */
const MARK_WIDTH = 40

/** What the form collects. */
interface Credentials {
  loginName: string
  secret: string
}

/**
 * The account glyph inside the member field; the Runner's sign-in page draws
 * this same pair, so the two forms read as one product.
 * @returns the glyph.
 */
function AccountIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3.1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 16c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The lock glyph inside the password field.
 * @returns the glyph.
 */
function PasswordIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4.5" y="8.2" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8.2V6.5a3 3 0 0 1 6 0v1.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
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
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <img
              src={WELINKIN_LOGO_SOURCE}
              width={MARK_WIDTH}
              height={(MARK_WIDTH * WELINKIN_LOGO_HEIGHT) / WELINKIN_LOGO_WIDTH}
              alt=""
            />
          </span>
          <span className="auth-brand-copy">
            <span className="auth-brand-name">{t('login.product')}</span>
            <span className="auth-brand-team">{t('app.subtitle')}</span>
          </span>
        </div>
        <h1 className="auth-heading">{t('login.heading')}</h1>
        <Form<Credentials> layout="vertical" onFinish={values => void submit(values)} requiredMark={false}>
          <Form.Item
            name="loginName"
            label={t('login.member')}
            rules={[{ required: true, message: t('login.required') }]}
          >
            <Input
              size="large"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              prefix={<AccountIcon />}
              placeholder={t('login.memberPlaceholder')}
            />
          </Form.Item>
          <Form.Item
            name="secret"
            label={t('login.password')}
            rules={[{ required: true, message: t('login.required') }]}
            {...(problem === undefined ? {} : { validateStatus: 'error' as const, help: problem })}
          >
            <Input.Password
              size="large"
              autoComplete="current-password"
              prefix={<PasswordIcon />}
              placeholder={t('login.passwordPlaceholder')}
            />
          </Form.Item>
          {/* Ant Design widens a two-character Chinese label into `登 录`; the
              Runner's own button does not, and the two sit side by side in a
              member's day. */}
          <Button
            className="auth-submit"
            type="primary"
            size="large"
            htmlType="submit"
            loading={busy}
            block
            autoInsertSpace={false}
          >
            {t('login.submit')}
          </Button>
        </Form>
        <p className="auth-note">{t('login.kicker')}</p>
      </Card>
    </div>
  )
}
