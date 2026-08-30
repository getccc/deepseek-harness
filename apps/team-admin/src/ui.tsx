/**
 * The pieces every view of the console shares: loading one collection,
 * showing a refusal, and rendering the two things every table renders.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { App, Form, Modal, Tag } from 'antd'
import { ApiError } from './api.ts'
import { useLocale } from './locale.tsx'
import type { CopyKey } from './locales.ts'

/** One collection the console reads, reloads, and writes back. */
export interface Loaded<T> {
  readonly data: T | undefined
  readonly loading: boolean
  /** Read it again from the Control Plane. */
  readonly reload: () => void
  /** Replace it with what a write answered, without a second round trip. */
  readonly replace: (next: T) => void
}

/**
 * Load one collection when the view mounts.
 *
 * A write answers with the collection it changed, so `replace` puts the new
 * state on screen without asking for it again — the answer and the reload
 * would be the same bytes, and one of them would be stale by a round trip.
 * @param load - reads the collection.
 * @param onError - shows a refusal.
 * @returns the collection and the two ways to change what is on screen.
 */
export function useLoaded<T>(load: () => Promise<T>, onError: (error: unknown) => void): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    load().then(
      (value) => {
        if (!current) return
        setData(value)
        setLoading(false)
      },
      (error: unknown) => {
        if (!current) return
        setLoading(false)
        onError(error)
      },
    )
    return () => { current = false }
    // `load` and `onError` are rebuilt every render by their callers, so they
    // are read rather than depended on; the generation counter is what a
    // reload actually changes.
  }, [generation])

  return {
    data,
    loading,
    reload: useCallback(() => { setGeneration(value => value + 1) }, []),
    replace: useCallback((next: T) => { setData(next) }, []),
  }
}

/** Shows a refusal as the console's own message. */
export type ErrorReporter = (error: unknown) => void

/**
 * Turn a refusal into a message a member can read.
 *
 * The server's `detail` is preferred where it says something this console
 * cannot know — which field of a model registration was wrong — and the
 * console's own copy covers the words it does know.
 * @returns a reporter bound to the current language.
 */
export function useErrorReporter(): ErrorReporter {
  const { t } = useLocale()
  const { message } = App.useApp()
  return useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) {
      void message.error(t('error.unavailable'))
      return
    }
    // The reason names the case this console has copy for; the error word
    // covers the rest. The server's English `detail` is the last resort,
    // because a sentence it wrote is not this console's to translate.
    const byError: Partial<Record<string, CopyKey>> = {
      unauthenticated: 'error.unauthenticated',
      forbidden: 'error.forbidden',
      unavailable: 'error.unavailable',
    }
    const key: CopyKey | undefined = error.reason === undefined
      ? byError[error.error]
      : `refuse.${error.reason}`
    void message.error(key === undefined ? error.detail ?? t('error.unavailable') : t(key))
  }, [message, t])
}

/**
 * A status word with stable colour.
 *
 * Every status this console renders either says the thing is in service or
 * says it is not, so the tag has the two colours those words carry.
 * @param props.value - the status as the server spells it.
 * @returns the tag element.
 */
export function StatusTag({ value }: { readonly value: string }): ReactNode {
  const { t } = useLocale()
  const known: Partial<Record<string, CopyKey>> = {
    active: 'status.active',
    suspended: 'status.suspended',
    revoked: 'status.revoked',
    retired: 'status.retired',
  }
  const key = known[value]
  return (
    <Tag color={value === 'active' ? 'green' : 'red'}>
      {key === undefined ? value : t(key)}
    </Tag>
  )
}

/**
 * A timestamp in the table's compact form, or the word for never.
 * @param props.value - epoch milliseconds, or undefined.
 * @returns the text element.
 */
export function Moment({ value }: { readonly value: number | undefined }): ReactNode {
  const { t } = useLocale()
  if (value === undefined) return <span>{t('action.never')}</span>
  return <span>{new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
}

/**
 * A dialog whose body is a form, submitted by its own confirm button.
 *
 * Every create and edit in this console is one of these, so the wiring between
 * the dialog's button and the form's validation lives here once: `onSubmit`
 * runs only after Ant Design's own validation passes, and the dialog stays
 * open when the Control Plane refuses.
 * @param props.title - the dialog heading.
 * @param props.open - whether the dialog is showing.
 * @param props.okText - the confirm button's copy.
 * @param props.initialValues - what the fields start as.
 * @param props.onCancel - closes the dialog without submitting.
 * @param props.onSubmit - carries out the write; rejecting keeps the dialog open.
 * @param props.children - the form items.
 * @returns the dialog element.
 */
export function FormModal<V extends object>({
  title, open, okText, initialValues, onCancel, onSubmit, children,
}: {
  readonly title: string
  readonly open: boolean
  readonly okText: string
  readonly initialValues?: Partial<V>
  readonly onCancel: () => void
  readonly onSubmit: (values: V) => Promise<void>
  readonly children: ReactNode
}): ReactNode {
  const { t } = useLocale()
  const [form] = Form.useForm<V>()
  const [busy, setBusy] = useState(false)

  const finish = async (values: V): Promise<void> => {
    setBusy(true)
    try {
      await onSubmit(values)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => { form.submit() }}
      okText={okText}
      cancelText={t('action.cancel')}
      confirmLoading={busy}
      destroyOnHidden
      forceRender
    >
      <Form<V>
        form={form}
        layout="vertical"
        requiredMark={false}
        preserve={false}
        {...(initialValues === undefined ? {} : { initialValues })}
        onFinish={values => void finish(values)}
      >
        {children}
      </Form>
    </Modal>
  )
}

/**
 * Ask before an act that takes something away.
 *
 * Suspending an account, revoking a device credential, unbinding a role, and
 * retiring a model all take effect at once and all read the same way in a
 * table, so each of them asks first in the same words.
 * @param props.title - what is about to happen.
 * @param props.body - what it will mean.
 * @param props.open - whether the dialog is showing.
 * @param props.danger - whether the confirm button reads as destructive.
 * @param props.onCancel - closes the dialog without acting.
 * @param props.onConfirm - carries out the act.
 * @returns the dialog element.
 */
export function ConfirmModal({
  title, body, open, danger = true, onCancel, onConfirm,
}: {
  readonly title: string
  readonly body: string
  readonly open: boolean
  readonly danger?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => Promise<void>
}): ReactNode {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      okText={t('action.confirm')}
      cancelText={t('action.cancel')}
      okButtonProps={{ danger }}
      confirmLoading={busy}
      onOk={() => {
        setBusy(true)
        void onConfirm().finally(() => { setBusy(false) })
      }}
    >
      {body}
    </Modal>
  )
}
