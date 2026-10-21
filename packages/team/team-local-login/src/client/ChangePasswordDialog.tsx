/** The dialog where a signed-in member replaces their own password. */

import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ChangePasswordDialog.module.css'

/** The password rules a deployment publishes with a refusal. */
export interface PasswordPolicy {
  /** Fewest characters a password may have. */
  readonly minLength: number
  /** Character classes a password must contain at least one of, each. */
  readonly requiredClasses: readonly ('uppercase' | 'lowercase' | 'digit')[]
}

/** Why a password change did not happen, in the words the dialog has copy for. */
export type ChangePasswordFailure =
  | {
    readonly reason:
      | 'current-incorrect' | 'unchanged' | 'expired' | 'unreachable' | 'update-required' | 'unsupported' | 'failed'
  }
  | { readonly reason: 'weak'; readonly policy?: PasswordPolicy }

/** What the local Host answered to a password change. */
export type ChangePasswordResult = { readonly ok: true } | ({ readonly ok: false } & ChangePasswordFailure)

/** Props of the password dialog. */
export interface ChangePasswordDialogProps {
  /** Whether the dialog is showing. */
  readonly open: boolean
  /** Close the dialog, from Cancel, the close button, Escape, or Done. */
  readonly onClose: () => void
  /** Ask the local Host to change the password. */
  readonly changePassword: (currentSecret: string, newSecret: string) => Promise<ChangePasswordResult>
  /** Translator of the `team.account` namespace. */
  readonly t: TranslateNS<'team.account'>
}

/** The one line a failed attempt shows. */
function failureLine(failure: ChangePasswordFailure, t: ChangePasswordDialogProps['t']): string {
  switch (failure.reason) {
    case 'current-incorrect': return t('password.error.incorrect')
    case 'unchanged': return t('password.error.same')
    case 'expired': return t('password.error.expired')
    case 'unreachable': return t('password.error.unreachable')
    case 'update-required': return t('password.error.update')
    case 'unsupported': return t('password.error.unsupported')
    case 'failed': return t('password.error.failed')
    case 'weak': {
      const policy = failure.policy
      if (policy === undefined) return t('password.error.weak')
      const classes = policy.requiredClasses.map(name => t(`password.class.${name}`)).join(t('password.class.separator'))
      return classes === ''
        ? t('password.error.weakLength', { count: policy.minLength })
        : t('password.error.weakRules', { count: policy.minLength, classes })
    }
    /* v8 ignore next 4 -- closed-union backstop; the compiler rejects a failure
    reason that has no copy. */
    default: {
      const unreachable: never = failure
      throw new Error(`unhandled password failure: ${JSON.stringify(unreachable)}`)
    }
  }
}

/** The three inputs, which an error can sit under. */
type Field = 'current' | 'new' | 'confirm'

/** Errors by the field they sit under; `form` holds the ones no single field caused. */
type Errors = Partial<Record<Field | 'form', string>>

/** The field a refusal is about, when it is about one. */
function failureField(failure: ChangePasswordFailure): Field | undefined {
  switch (failure.reason) {
    case 'current-incorrect': return 'current'
    case 'unchanged':
    case 'weak': return 'new'
    default: return undefined
  }
}

/**
 * Render the change-password dialog.
 *
 * The form checks only what the member can fix without a round trip: every
 * field filled, and the two new entries equal. Whether the current password is
 * right and whether the new one satisfies the deployment's rules are the
 * Control Plane's answers. Each error appears in red under the field it is
 * about; a failure that is about no field, such as an unreachable service,
 * appears above the buttons.
 * @param props - dialog state, the close command, the change operation, and the translator.
 * @returns the modal while open, otherwise null.
 */
export function ChangePasswordDialog({ open, onClose, changePassword, t }: ChangePasswordDialogProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const idBase = useId()

  const forgetPasswords = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  const close = () => {
    // Typed passwords do not outlive the dialog that collected them.
    forgetPasswords()
    setErrors({})
    setDone(false)
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const missing: Errors = {
      ...(current === '' ? { current: t('password.error.currentEmpty') } : {}),
      ...(next === '' ? { new: t('password.error.newEmpty') } : {}),
      ...(confirm === '' ? { confirm: t('password.error.confirmEmpty') } : {}),
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      return
    }
    if (next !== confirm) {
      setErrors({ confirm: t('password.error.mismatch') })
      return
    }
    setSubmitting(true)
    setErrors({})
    const result = await changePassword(current, next)
    setSubmitting(false)
    if (result.ok) {
      forgetPasswords()
      setDone(true)
    } else {
      setErrors({ [failureField(result) ?? 'form']: failureLine(result, t) })
    }
  }

  /** A field's change handler: the new value replaces the old, and the error about it goes away. */
  const edit = (field: Field, set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value)
    setErrors(({ [field]: _, form: __, ...rest }) => rest)
  }

  /** One labelled password input with its error beneath it. */
  const renderField = (
    field: Field, label: string, value: string, set: (value: string) => void,
    autoComplete: 'current-password' | 'new-password', autoFocus = false,
  ) => {
    const message = errors[field]
    const id = `${idBase}-${field}`
    return (
      <div className={css.field}>
        <label className={css.label} htmlFor={id}>{label}</label>
        <Input
          id={id}
          className={`${css.input as string} ${message === undefined ? '' : css.invalid as string}`}
          type="password"
          name={`${field}Secret`}
          autoComplete={autoComplete}
          {...(autoFocus ? { 'data-modal-autofocus': true } : {})}
          aria-invalid={message !== undefined}
          {...(message === undefined ? {} : { 'aria-describedby': `${id}-error` })}
          value={value}
          readOnly={submitting}
          onChange={edit(field, set)}
        />
        {message !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{message}</p>}
      </div>
    )
  }

  return (
    <Modal
      open={open}
      title={t('password.title')}
      closeLabel={t('password.close')}
      {...(done ? {} : { description: t('password.description') })}
      onClose={close}
      className={css.dialog as string}
    >
      {done
        ? (
          <>
            <p className={css.done} role="status">{t('password.done')}</p>
            <div className={css.actions}>
              <Button variant="primary" onClick={close} data-modal-autofocus>{t('password.finish')}</Button>
            </div>
          </>
        )
        : (
          <form className={css.form} onSubmit={(event) => { void submit(event) }}>
            {renderField('current', t('password.current'), current, setCurrent, 'current-password', true)}
            {renderField('new', t('password.new'), next, setNext, 'new-password')}
            {renderField('confirm', t('password.confirm'), confirm, setConfirm, 'new-password')}
            {errors.form !== undefined && <p className={css.error} role="alert">{errors.form}</p>}
            <div className={css.actions}>
              <Button type="button" variant="outline" disabled={submitting} onClick={close}>
                {t('password.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? t('password.submitting') : t('password.submit')}
              </Button>
            </div>
          </form>
        )}
    </Modal>
  )
}
