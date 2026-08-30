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
