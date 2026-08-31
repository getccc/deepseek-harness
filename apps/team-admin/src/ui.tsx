/**
 * The pieces every view of the console shares: loading one collection,
 * showing a refusal, and rendering the two things every table renders.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App, Avatar, Button, Form, Modal, Switch, Tag } from 'antd'
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
  if (value === undefined) return <span className="moment">{t('action.never')}</span>
  return (
    <span className="moment">{new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
  )
}

/**
 * Copy a dialog shows, held steady while it closes.
 *
 * Every dialog here names what it is about — a role, a member, a department —
 * and the state carrying that record is cleared the moment the dialog is
 * dismissed, while the dialog itself is still animating out. Reading the last
 * heading it was open with keeps the words from emptying in front of the reader.
 * @param title - the copy for the record the dialog is about.
 * @param open - whether the dialog is showing.
 * @returns the copy to render.
 */
function useSteadyCopy(title: string, open: boolean): string {
  const shown = useRef(title)
  if (open) shown.current = title
  return shown.current
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
  const heading = useSteadyCopy(title, open)

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
      title={heading}
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
  const heading = useSteadyCopy(title, open)
  const shownBody = useSteadyCopy(body, open)
  return (
    <Modal
      title={heading}
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
      {shownBody}
    </Modal>
  )
}

/**
 * The muted sentence that says what a page administers.
 * @param props.text - the already-translated sentence.
 * @returns the paragraph element.
 */
export function PageNote({ text }: { readonly text: string }): ReactNode {
  return <p className="page-note">{text}</p>
}

/**
 * The row of filters and actions above a table.
 *
 * Filters sit at the start and actions at the end, which is the order every
 * view here reads in: what narrows the table, then what changes it.
 * @param props.filters - the search controls.
 * @param props.actions - the buttons that act on the collection.
 * @returns the toolbar element.
 */
export function Toolbar({
  filters, actions,
}: { readonly filters?: ReactNode; readonly actions?: ReactNode }): ReactNode {
  return (
    <div className="toolbar">
      <div className="toolbar-filters">{filters}</div>
      <div className="toolbar-actions">{actions}</div>
    </div>
  )
}

/**
 * A row's in-service switch, which asks before it changes anything.
 *
 * The switch shows the stored state and does not move on click: the state
 * changes when the Control Plane answers, so a refused change never leaves the
 * control claiming something the server does not hold.
 * @param props.active - whether the record is in service.
 * @param props.disabled - whether this member may change it.
 * @param props.onToggle - opens the confirmation for the change.
 * @returns the switch element.
 */
export function StatusSwitch({
  active, disabled, onToggle,
}: {
  readonly active: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
}): ReactNode {
  return (
    <Switch
      size="small"
      checked={active}
      disabled={disabled}
      onChange={() => { onToggle() }}
    />
  )
}

/** How many people a row shows before it shows only the count. */
const FACES = 4

/**
 * The people on a row: a few initials, then how many there are.
 * @param props.names - display names, in the order the server listed them.
 * @param props.empty - what to show when there is nobody.
 * @returns the group element.
 */
export function People({
  names, empty,
}: { readonly names: readonly string[]; readonly empty: string }): ReactNode {
  if (names.length === 0) return <Tag>{empty}</Tag>
  return (
    <span className="people">
      {names.slice(0, FACES).map(name => (
        <Avatar key={name} size={22} className="people-face">{Array.from(name)[0]}</Avatar>
      ))}
      <Tag className="people-count">{names.length}</Tag>
    </span>
  )
}

/** One control on a table row. */
export interface RowAction {
  readonly key: string
  readonly label: string
  /** Drawn as a destructive control. */
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}

/**
 * The link-styled controls at the end of a table row.
 * @param props.actions - the controls, in the order they are read.
 * @returns the controls element.
 */
export function RowActions({ actions }: { readonly actions: readonly RowAction[] }): ReactNode {
  return (
    <span className="row-actions">
      {actions.map(action => (
        <Button
          key={action.key}
          type="link"
          size="small"
          danger={action.danger === true}
          disabled={action.disabled === true}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </span>
  )
}

/**
 * Build the nested rows an Ant Design table draws from a flat list.
 *
 * A record whose parent is not in the list becomes a root, so filtering the
 * list never hides a record behind a parent that was filtered out.
 * @param records - the flat list, parents already before their children.
 * @param idOf - reads a record's own id.
 * @param parentOf - reads the id of the record it sits under, if any.
 * @returns the roots, each carrying its own subtree.
 */
export function toTree<T>(
  records: readonly T[],
  idOf: (record: T) => string,
  parentOf: (record: T) => string | undefined,
): T[] {
  const known = new Set(records.map(idOf))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const record of records) {
    const parent = parentOf(record)
    if (parent === undefined || !known.has(parent)) roots.push(record)
    else children.set(parent, [...children.get(parent) ?? [], record])
  }
  const attach = (record: T): T => {
    const own = children.get(idOf(record))
    return own === undefined ? record : { ...record, children: own.map(attach) }
  }
  return roots.map(attach)
}

/**
 * Hand the browser a comma-separated file of what a table is showing.
 *
 * Built here rather than asked of the Control Plane: the rows are already on
 * screen, and a second request would export a different moment than the one an
 * administrator is looking at.
 * @param name - the file name, without an extension.
 * @param header - the column titles, already translated.
 * @param rows - one array of cell values per row.
 */
export function downloadCsv(
  name: string,
  header: readonly string[],
  rows: readonly (readonly string[])[],
): void {
  // A cell is quoted always and its own quotes doubled, which is the whole of
  // the escaping a comma-separated file needs.
  const cell = (value: string): string => `"${value.replaceAll('"', '""')}"`
  const text = [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
  // The byte-order mark is what makes a spreadsheet read this as UTF-8.
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
