/** Locale-owned office renderer labels and status text. */
export const zh = {
  'title.docx': 'Word 文档',
  'title.xlsx': 'Excel 工作簿',
  'title.pptx': 'PowerPoint 演示文稿',
  loading: '正在打开文档…',
  failed: '无法显示这份文档。',
  unsupported: '文档预览需要完整文件内容。',
  retry: '重试',
  'sheet.tabs': '工作表',
  'sheet.empty': '这张工作表没有内容。',
  'sheet.truncated': '仅显示前 {rows} 行、前 {columns} 列。',
} satisfies Record<string, string>

/** Office renderer dictionary keys. */
export type OfficePreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  'title.docx': 'Word document',
  'title.xlsx': 'Excel workbook',
  'title.pptx': 'PowerPoint presentation',
  loading: 'Opening document…',
  failed: 'This document could not be displayed.',
  unsupported: 'Document preview requires the complete file contents.',
  retry: 'Retry',
  'sheet.tabs': 'Worksheets',
  'sheet.empty': 'This worksheet is empty.',
  'sheet.truncated': 'Showing the first {rows} rows and {columns} columns.',
} satisfies Record<OfficePreviewKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office document preview selection and status text. */
    sidebarOffice: OfficePreviewKey
  }
}
