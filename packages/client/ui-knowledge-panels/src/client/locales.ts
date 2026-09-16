/** `knowledgePanels` namespace dictionaries: the two navigation rows, the knowledge-base list, and the retrieval panel. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'bases.title': '知识库',
  'bases.loading': '正在读取知识库',
  'bases.empty': '当前没有你可以访问的知识库',
  'bases.failed': '知识库读取失败',
  'bases.retry': '重试',
  'bases.search': '检索这个知识库',
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
  'draft.template': '关于《{title}》中的这段内容：\n\n> {text}\n\n',
} satisfies Record<string, string>

/** The knowledgePanels namespace key union. */
export type KnowledgePanelsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'bases.title': 'Knowledge',
  'bases.loading': 'Reading knowledge bases',
  'bases.empty': 'You have access to no knowledge base right now',
  'bases.failed': 'Knowledge bases could not be read',
  'bases.retry': 'Retry',
  'bases.search': 'Search this knowledge base',
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
  'draft.template': 'About this part of "{title}":\n\n> {text}\n\n',
} satisfies Record<KnowledgePanelsKey, string>
