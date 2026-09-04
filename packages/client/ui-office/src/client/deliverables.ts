/**
 * How the office tools' output joins the produced-files row.
 *
 * The univer office tools hand a document back through `univer_export`, whose
 * `output` argument names the `.docx`, `.xlsx`, or `.pptx` file written; the
 * first-party deliverables vocabulary reads only the text mutation tools, so
 * without this recognizer a turn that produced a deck ends with no card.
 * @module @deepseek-ai/dsh-client-ui-office/client/deliverables
 */
import type { ProducedFileRecognizer } from '@deepseek-ai/dsh-client-ui-deliverables/client'

/** The `univer_export` call, read by the file it wrote. */
export const UNIVER_EXPORT_RECOGNIZER: ProducedFileRecognizer = {
  tool: 'univer_export',
  path: args => typeof args.output === 'string' ? args.output : null,
}
