/** Generated office fixtures: a Word package and a workbook, shared by the package specs and the Web e2e lane. */
import JSZip from 'jszip'
import { utils, write } from 'xlsx'

/**
 * The smallest Word document docx-preview lays out: one paragraph.
 * @param text - the paragraph's text.
 * @returns the zipped package bytes.
 */
export async function minimalDocx(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body>
</w:document>`)
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new Uint8Array(bytes)
}

/**
 * A workbook with one worksheet per entry, written the way Excel would save it.
 * @param sheets - worksheet names to their rows.
 * @returns the zipped package bytes.
 */
export function workbookBytes(sheets: Record<string, unknown[][]>): Uint8Array<ArrayBuffer> {
  const workbook = utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name)
  return new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}
