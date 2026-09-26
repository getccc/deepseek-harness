/**
 * The Recent list filling the sidebar shell's `sidebar.recent` hole below the
 * Workspace tree: a section header (title + kind filter) and every Session of
 * the admitted kinds, newest-first, each row the tree's Session row. Rows
 * render the browser entry's row seats, so every row action (pin, rename,
 * fork, archive, and any plugin's) and row decoration the tree shows reaches
 * them too. The kind filter persists in the viewing store shared with the
 * Workspace browser, and the browser's archived filter applies here as well.
 * The rail state renders nothing: the shell's rail already carries the New
 * chat control and the browser's icons.
 */
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { IconPersonalizationOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RecentBrowserProps } from '../contract/slots.ts'
import { deriveRecent, mainSessionId, type RecentFilter, type SessionRowState } from '../tree.ts'
import { AnimatedRows } from './AnimatedRows.tsx'
import { SessionNodeItem } from './Rows.tsx'
import css from './RecentBrowser.module.css'

/** Filter rows in menu order. */
const FILTERS: readonly RecentFilter[] = ['chat', 'work', 'all']

/** Kind filter menu; own open state so it resets with the wide chrome. */
function RecentFilterMenu({ filter, onPick, t }: {
  filter: RecentFilter
  onPick: (filter: RecentFilter) => void
  t: RecentBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={FILTERS.map(id => ({ id, label: t(`recent.filter.${id}`) }))}
      selectedId={filter}
      // The menu carries exactly FILTERS, so the selected id is one of them.
      onSelect={(id) => {
        onPick(id as RecentFilter)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('recent.filter.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('recent.filter.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutlineRegular />
          </button>
        </Tooltip>
      )}
    />
  )
}

/**
 * Render the Recent list.
 * @param props - composed slot props (shell owner share + shared store + row verbs + the browser's row seats).
 * @returns the section element tree, or null in the rail state.
 */
export function RecentBrowser({
  wide,
  usePanelInfo,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  useStore,
  actions,
  open,
  requestSessionRename,
  notifyArchivedNotOpenable,
  useRowSeats,
  t,
}: RecentBrowserProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const { renderSlot } = useRowSeats(seats => seats)
  const filter = useStore(s => s.recentFilter)
  // Persisted view blobs written before the archived filter existed
  // rehydrate without the field; they read as the default hide-archived view.
  const archivedFilter = useStore(s => s.archivedFilter ?? 'default')
  const rowState = useMemo<SessionRowState>(
    () => ({ pinnedSessionIds, archivedSessionIds, archivedFilter }),
    [pinnedSessionIds, archivedSessionIds, archivedFilter],
  )
  const rows = useMemo(
    () => deriveRecent(list, rowState, statuses, filter),
    [list, rowState, statuses, filter],
  )
  // Archived sessions are not openable: the row stays visible under the
  // filter but a click explains instead of navigating.
  const guardedOpen = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    open(sessionId)
  }
  if (!wide) return null
  const now = Date.now()
  const currentId = panelActive ? undefined : mainSessionId(list)
  return (
    <div className={css.root}>
      <div className={css.sectionHeader}>
        <span className={css.sectionLabel}>{t('section.recent')}</span>
        <RecentFilterMenu filter={filter} onPick={(next) => { actions.setRecentFilter(next) }} t={t} />
      </div>
      <div className={css.body}>
        <AnimatedRows
          className={clsx(css.list)}
          label={t('section.recent')}
          rowKeys={rows.length === 0 ? ['empty'] : rows.map(row => `session:${row.id}`)}
          ready={list.phase === 'ready'}
          resetKey={`${filter}/${archivedFilter}`}
        >
          {rows.length === 0 && <div className={css.empty} data-row-key="empty">{t('recent.empty')}</div>}
          {rows.map(node => (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentId}
              now={now}
              onOpen={guardedOpen}
              onRenameRequest={requestSessionRename}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
        </AnimatedRows>
      </div>
    </div>
  )
}
