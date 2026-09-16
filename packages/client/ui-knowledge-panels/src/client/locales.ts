/**
 * `knowledgePanels` namespace dictionaries: the two navigation rows, the
 * knowledge-base list with its documents, and the retrieval panel.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'bases.title': '知识库',
  'bases.subtitle': '你有权限的知识库，点击卡片查看其中的文档',
  'bases.loading': '正在读取知识库',
  'bases.empty': '当前没有你可以访问的知识库',
  'bases.failed': '知识库读取失败',
  'bases.retry': '重试',
  'bases.description.empty': '无描述',
  'bases.documents': '{count} 篇文档',
  'bases.created': '创建于 {day}',
  'crumbs.label': '当前位置',
  'docs.subtitle': '点击一份文档，在右侧查看它的内容',
  'docs.loading': '正在读取文档',
  'docs.empty': '这个知识库里还没有文档',
  'docs.failed': '文档列表读取失败',
  'docs.count': '共 {total} 篇',
  'docs.page': '第 {page} 页',
  'docs.prev': '上一页',
  'docs.next': '下一页',
  'docs.pager': '文档分页',
  'docs.state.processing': '解析中',
  'docs.state.unavailable': '不可检索',
  'drawer.close': '关闭',
  'preview.loading': '正在读取文档内容',
  'preview.failed': '文档内容读取失败',
  'preview.truncated': '（内容已截断）',
  'preview.unsupported': '这里还不能显示这种文件，请在对话中打开它',
  'search.title': '知识库检索',
  'search.scope': '检索范围',
  'search.scope.all': '全部知识库',
  'search.placeholder': '描述你要找的内容',
  'search.run': '检索',
  'search.running': '正在检索',
  'search.empty': '没有检索到相关内容',
  'search.failed': '检索失败',
  'search.truncated': '结果已达上限，缩小检索范围可以看到更多',
  'search.summary': '共 {passages} 段，来自 {documents} 篇原文',
  'search.score': '相似度 {score}',
  'search.passage.truncated': '（本段已截断）',
  'search.discuss': '讨论这篇原文',
  'search.discuss.failed': '无法打开讨论',
} satisfies Record<string, string>

/** The knowledgePanels namespace key union. */
export type KnowledgePanelsKey = keyof typeof zh

/**
 * The bound translate this package's plain components take.
 *
 * Components the framework composes receive `t` through `PropsLocale`; the
 * preview column is composed by this package instead, so it names the same
 * seat explicitly.
 */
export type Translate = (key: KnowledgePanelsKey, params?: Record<string, unknown>) => string

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'bases.title': 'Knowledge',
  'bases.subtitle': 'The knowledge bases you may use; open one to see its documents',
  'bases.loading': 'Reading knowledge bases',
  'bases.empty': 'You have access to no knowledge base right now',
  'bases.failed': 'Knowledge bases could not be read',
  'bases.retry': 'Retry',
  'bases.description.empty': 'No description',
  'bases.documents': '{count} documents',
  'bases.created': 'Created {day}',
  'crumbs.label': 'You are here',
  'docs.subtitle': 'Open a document to read it beside the list',
  'docs.loading': 'Reading documents',
  'docs.empty': 'This knowledge base holds no document yet',
  'docs.failed': 'The documents could not be read',
  'docs.count': '{total} documents',
  'docs.page': 'Page {page}',
  'docs.prev': 'Previous',
  'docs.next': 'Next',
  'docs.pager': 'Document pages',
  'docs.state.processing': 'Processing',
  'docs.state.unavailable': 'Not searchable',
  'drawer.close': 'Close',
  'preview.loading': 'Reading the document',
  'preview.failed': 'The document could not be read',
  'preview.truncated': '(content cut)',
  'preview.unsupported': 'This kind of file cannot be shown here yet; open it from a conversation',
  'search.title': 'Knowledge search',
  'search.scope': 'Search in',
  'search.scope.all': 'All knowledge bases',
  'search.placeholder': 'Describe what you are looking for',
  'search.run': 'Search',
  'search.running': 'Searching',
  'search.empty': 'Nothing matched',
  'search.failed': 'Search failed',
  'search.truncated': 'Results reached the limit; narrow the scope to see more',
  'search.summary': '{passages} passages from {documents} documents',
  'search.score': 'Score {score}',
  'search.passage.truncated': '(passage cut)',
  'search.discuss': 'Discuss this document',
  'search.discuss.failed': 'The discussion could not be opened',
} satisfies Record<KnowledgePanelsKey, string>
