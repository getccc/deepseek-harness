/**
 * Reading what a provider says a call cost, out of a response nobody buffers.
 *
 * The settlement rules need the provider's own usage when it is available, and
 * a marked estimate when it is not. Getting it therefore means watching the
 * response go past rather than holding it: a completion is long, and a
 * Control Plane serves one per member at once.
 * @module @deepseek-ai/dsh-model-gateway-http/usage
 */

/** What a provider reported about one call. */
export interface ReportedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** The two field spellings providers use for the same two numbers. */
const INPUT_FIELDS = ['prompt_tokens', 'input_tokens'] as const
const OUTPUT_FIELDS = ['completion_tokens', 'output_tokens'] as const

/** Read one non-negative integer field out of a usage object. */
function count(usage: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const value = usage[field]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  }
  return undefined
}

/**
 * Read a usage object, when a value is one.
 * @param value - a parsed `usage` field, or anything else.
 * @returns the two counts, or undefined when either is missing.
 */
export function readUsage(value: unknown): ReportedUsage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const usage = value as Record<string, unknown>
  const inputTokens = count(usage, INPUT_FIELDS)
  const outputTokens = count(usage, OUTPUT_FIELDS)
  // Half a report is not a report: charging an input count with an invented
  // output would be an estimate wearing a provider's authority.
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  return { inputTokens, outputTokens }
}

/**
 * Watches a response go past and remembers the last usage it saw.
 *
 * One object at a time, never the response. Both shapes are handled by the
 * same scanner: a non-streaming body is one JSON document, and a streaming one
 * is a sequence of `data:` lines whose last few carry the usage — so the
 * scanner keeps only the current line and the newest usage.
 */
export class UsageScanner {
  private pending = ''
  private latest: ReportedUsage | undefined

  /**
   * Feed one chunk of the response.
   * @param chunk - bytes as they arrive from the provider.
   */
  push(chunk: Buffer): void {
    this.pending += chunk.toString('utf8')
    let newline = this.pending.indexOf('\n')
    while (newline >= 0) {
      this.line(this.pending.slice(0, newline))
      this.pending = this.pending.slice(newline + 1)
      newline = this.pending.indexOf('\n')
    }
    // A body with no newline at all is one document; keeping it is bounded by
    // the response-size limit the caller enforces, not by this scanner.
  }

  /**
   * Finish, reading whatever the response ended with.
   * @returns the newest usage the provider reported, or undefined when it reported none.
   */
  end(): ReportedUsage | undefined {
    this.line(this.pending)
    this.pending = ''
    return this.latest
  }

  /** Read one line, which may be a JSON document or an SSE `data:` frame. */
  private line(raw: string): void {
    const text = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim()
    if (text.length === 0 || text === '[DONE]' || !text.startsWith('{')) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // A partial or non-JSON line is not usage; the next one may be.
      return
    }
    const usage = readUsage((parsed as Record<string, unknown>).usage)
    // The newest wins: a stream reports usage in its final frames, and an
    // earlier frame carrying a partial count should not outrank the last word.
    if (usage !== undefined) this.latest = usage
  }
}
