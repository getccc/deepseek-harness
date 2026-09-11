/** Locale-owned office renderer labels, controls, and status text. */
export const zh = {
  'title.docx': 'Word 文档',
  'title.xlsx': 'Excel 工作簿',
  'title.pptx': 'PowerPoint 演示文稿',
  loading: '正在打开文档…',
  failed: '无法显示这份文档。',
  unsupported: '文档预览需要完整文件内容。',
  retry: '重试',
  'docx.zoom': '缩放',
  'docx.zoomHint': 'Alt + 滚轮',
  'docx.zoomValue': '{zoom}%',
  'docx.fitWidth': '适应宽度',
  'pptx.previous': '上一页',
  'pptx.next': '下一页',
  'pptx.position': '{current} / {total}',
  'pptx.rail': '幻灯片缩略图',
  'pptx.slide': '第 {index} 页',
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
  'docx.zoom': 'Zoom',
  'docx.zoomHint': 'Alt + wheel',
  'docx.zoomValue': '{zoom}%',
  'docx.fitWidth': 'Fit width',
  'pptx.previous': 'Previous',
  'pptx.next': 'Next',
  'pptx.position': '{current} / {total}',
  'pptx.rail': 'Slide thumbnails',
  'pptx.slide': 'Slide {index}',
} satisfies Record<OfficePreviewKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office document preview selection, controls, and status text. */
    sidebarOffice: OfficePreviewKey
  }
}
