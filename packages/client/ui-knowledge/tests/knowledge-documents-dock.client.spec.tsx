// @vitest-environment jsdom
/**
 * The documents dock over the `knowledge` projection: it shows a conversation's
 * documents the way attached files are shown, only while the recorded scope
 * narrows to documents, and takes one off at a click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { KnowledgeDocRef, KnowledgeRef, KnowledgeScope } from '@deepseek-ai/dsh-knowledge'
import { KnowledgeDocumentsDock, type KnowledgeDocumentsDockProps } from '../src/client/KnowledgeDocumentsDock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const REF = 'weknora:prod:690c0727' as KnowledgeRef
const DOC_A = `${REF}/doc-1` as KnowledgeDocRef
const DOC_B = `${REF}/doc-2` as KnowledgeDocRef

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: KnowledgeDocumentsDockProps['t'] = makeTranslate(zh, commonZh)

/** Render the dock over one projected scope. */
function setup(scope: KnowledgeScope | undefined, remove = vi.fn().mockResolvedValue(undefined)) {
  const store = createSnapshotStore<{ value: KnowledgeScope | undefined }>({ value: scope })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { sessionId: 's1', useProjection, remove, t } as unknown as KnowledgeDocumentsDockProps
  return { remove, view: render(<KnowledgeDocumentsDock {...props} />) }
}

/** A scope narrowed to the given documents in one knowledge base. */
function narrowed(documents: { ref: KnowledgeDocRef; title: string }[]): KnowledgeScope {
  return { version: 1, mode: 'selected', bases: [{ ref: REF, displayName: '临港知识库', documents }] }
}

describe('KnowledgeDocumentsDock', () => {
  it.each<[string, KnowledgeScope | undefined]>([
    ['a Host that folds no knowledge scope', undefined],
    ['a conversation with knowledge off', { version: 1, mode: 'off' }],
    ['a conversation over whole knowledge bases', {
      version: 1, mode: 'selected', bases: [{ ref: REF, displayName: '临港知识库' }],
    }],
  ])('renders nothing for %s', (_label, scope) => {
    expect(setup(scope).view.container.innerHTML).toBe('')
  })

  it('shows each document by the title it was chosen by, and names an untitled one', () => {
    setup(narrowed([{ ref: DOC_A, title: '中微公司2020年第一季度报告正文.pdf' }, { ref: DOC_B, title: '' }]))
    expect(screen.getByRole('group', { name: '本次对话基于 临港知识库 中的这些文档回答' })).toBeTruthy()
    expect(screen.getByText('中微公司2020年第一季度报告正文.pdf')).toBeTruthy()
    expect(screen.getByText('未命名文档')).toBeTruthy()
  })

  it('takes a document off at a click on its own control', async () => {
    const { remove } = setup(narrowed([{ ref: DOC_A, title: '运维手册' }]))
    fireEvent.click(screen.getByRole('button', { name: '从本次对话中移除 运维手册' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(DOC_A) })
    expect(screen.queryByText('未能移除这份文档')).toBeNull()
  })

  it('says so when a document could not be taken off, and clears it on the next try', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined)
    setup(narrowed([{ ref: DOC_A, title: '运维手册' }]), remove)
    fireEvent.click(screen.getByRole('button', { name: '从本次对话中移除 运维手册' }))
    expect(await screen.findByText('未能移除这份文档')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从本次对话中移除 运维手册' }))
    await waitFor(() => { expect(screen.queryByText('未能移除这份文档')).toBeNull() })
  })
})
