/**
 * The office-deliverable choice vocabulary: the kind a conversation should
 * produce, the Session log event that records it, the fold that recovers it,
 * and the validator that reads one back off a wire.
 *
 * This is the shared vocabulary both the model-facing tool and the Remote
 * controller build on; it carries no plugin and no module augmentation beyond
 * the Session event, so a Typert Remote that names {@link OfficeChoice} does
 * not drag a projection registry into its generated face.
 * @module @deepseek-ai/dsh-office
 */

export {
  OFFICE_KINDS,
  isOfficeKind,
  type OfficeChoice,
  type OfficeKind,
} from './types.ts'
export { DEFAULT_OFFICE_CHOICE, foldOfficeChoice, parseOfficeChoice } from './scope.ts'
