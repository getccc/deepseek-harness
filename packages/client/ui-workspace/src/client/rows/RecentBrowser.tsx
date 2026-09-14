/**
 * The Recent list filling the sidebar shell's `sidebar.recent` hole below the
 * Workspace tree: a section header (title + kind filter) and every visible
 * Session of the admitted kinds, newest-first, each row the flat presentation
 * of the tree's Session row with the same rename/fork/archive menu. The kind
 * filter persists in the viewing store shared with the Workspace browser.
 * The rail state renders nothing: the shell's rail already carries the New
 * chat control and the browser's icons.
 */
import { useMemo, useState } from 'react'
import { IconPersonalizationOutline16, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RecentBrowserProps } from '../contract/slots.ts'
import { deriveRecent, type RecentFilter, type SessionNode } from '../tree.ts'
import { SessionNodeItem } from './Rows.tsx'
import { SessionRenameDialog, type SessionRenameTarget } from './SessionRenameDialog.tsx'
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
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/**
 * Render the Recent list.
 * @param props - composed slot props (shell owner share + shared store + row actions).
 * @returns the section element tree, or null in the rail state.
 */
export function RecentBrowser({
  wide,
  usePanelInfo,
  useSessions,
  useSessionPendingInteraction,
  useWorkspaces,
  useStore,
  actions,
  open,
  renameSession,
  forkSession,
  archiveSession,
  t,
}: RecentBrowserProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const filter = useStore(s => s.recentFilter)
  const rows = useMemo(
    () => deriveRecent(list, archivedSessionIds, pendingInteractions, filter),
    [list, archivedSessionIds, pendingInteractions, filter],
  )
  // Rename dialog is list-owned so it outlives the row an archive removes.
  const [renameTarget, setRenameTarget] = useState<SessionRenameTarget | null>(null)
  const onRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setRenameTarget({ sessionId, currentTitle })
  }
  // Archive commits without a dialog (the log and accounting slot remain);
  // the row disappears when the archive-set echo lands.
  const onArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }
  if (!wide) return null
  const now = Date.now()
  return (
    <div className={css.root}>
      <div className={css.sectionHeader}>
        <span className={css.sectionLabel}>{t('section.recent')}</span>
        <RecentFilterMenu filter={filter} onPick={(next) => { actions.setRecentFilter(next) }} t={t} />
      </div>
      <div className={css.list} role="tree" aria-label={t('section.recent')}>
        {rows.length === 0 && <div className={css.empty}>{t('recent.empty')}</div>}
        {rows.map(node => (
          <SessionNodeItem
            key={node.id}
            node={node}
            currentId={panelActive ? undefined : list.current}
            now={now}
            onOpen={open}
            onRename={onRename}
            onFork={forkSession}
            onArchive={onArchive}
            flat
            t={t}
          />
        ))}
      </div>
      <SessionRenameDialog
        key={renameTarget?.sessionId ?? ''}
        target={renameTarget}
        onClose={() => { setRenameTarget(null) }}
        renameSession={renameSession}
        t={t}
      />
    </div>
  )
}
