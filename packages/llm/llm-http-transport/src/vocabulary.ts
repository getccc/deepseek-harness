/**
 * The provider operations this build carries.
 *
 * A closed list, registered in code. A transport that took an arbitrary path
 * would be a transport a caller could point anywhere, which is the whole thing
 * the seam exists to prevent.
 * @module @deepseek-ai/dsh-llm-http-transport/vocabulary
 */

/**
 * Every operation a transport knows how to reach.
 *
 * One entry today. The list exists so a second operation is an addition with a
 * name rather than a path a caller supplies, and so a Control Plane can refuse
 * an operation it has not agreed to carry.
 */
export const TRANSPORT_OPERATIONS = ['chat.completions'] as const

/**
 * Every input modality a transport-controlled catalog can declare for a model.
 *
 * One closed list for the Control Plane catalog that stores the declaration
 * and the adapter that reads it, so "this model accepts images" is a fact
 * written once rather than two hand-matched flags on either side of the wire.
 */
export const MODEL_INPUT_MODALITIES = ['text', 'image'] as const
