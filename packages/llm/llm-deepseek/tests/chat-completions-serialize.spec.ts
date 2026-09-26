/** Harness requests serialized into the Chat Completions wire form the built-in route carries. */
import { describe, expect, it } from 'vitest'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createDeveloperMessage, createToolResultMessage, createUserMessage, ToolCallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, RequestMessage, RequestUserInput } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import {
  serializeMessages,
  serializeMessagesWithImages,
  serializeRequest,
  serializeRequestWithImages,
} from '../src/chat-completions/serialize.ts'
import type { ImageSerializationOptions } from '../src/chat-completions/serialize.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
  }
  interface ContentBlockMap {
    'plugin:chart': { type: 'plugin:chart'; data: string }
  }
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'built-in', model: 'company-vision', messages: [], ...overrides }
}

function imageRef(mediaType: ImageMediaType = 'image/png', bytes = 3): ImageAttachmentRef {
  const digit = ({
    'image/png': 'a',
    'image/jpeg': 'b',
    'image/webp': 'c',
    'image/gif': 'd',
  } as const)[mediaType]
  return {
    attachmentId: AttachmentId(`sha256:${digit.repeat(64)}`),
    mediaType,
    bytes,
    width: 1,
    height: 1,
  }
}

/** The prepared request version of `ref`: `ref.bytes` zero bytes, so three encode as `AAAA`. */
function requestVersion(ref: ImageAttachmentRef): RequestImageAttachment {
  const hash = String(ref.attachmentId).slice('sha256:'.length)
  return {
    variantId: ImageVariantId(`sha256:${hash}`),
    attachment: ref,
    data: new Uint8Array(ref.bytes),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: ref.mediaType === 'image/png',
  }
}

function imageOptions(
  refs: readonly ImageAttachmentRef[],
  maxRequestImageBytes = 20 * 1024 * 1024,
  byteQuantum?: number,
): ImageSerializationOptions {
  return {
    requestImages: new Map(refs.map(ref => [ref.attachmentId, requestVersion(ref)])),
    maxRequestImageBytes,
    ...byteQuantum === undefined ? {} : { byteQuantum },
  }
}

const MODEL_SOURCE = { kind: 'model', provider: 'built-in', model: 'company-vision' } as const

describe('request-only user input', () => {
  it('preserves the exact text request and durable tool-result prefix', () => {
    const prefix = [
      createMessage({ role: 'assistant', content: [{ type: 'tool-call', id: ToolCallId('lookup'), name: 'lookup', arguments: '{}' }],
        source: MODEL_SOURCE }),
      createToolResultMessage({ callId: ToolCallId('lookup'), content: [{ type: 'text', text: 'result' }], isError: false }),
    ]
    const input: RequestUserInput = { role: 'user', content: [{ type: 'text', text: 'review or summarize this input' }] }
    const durable = createUserMessage({ content: input.content, source: { kind: 'test' } })
    expect(serializeRequest(request({ messages: [...prefix, input], system: 'policy' })))
      .toEqual(serializeRequest(request({ messages: [...prefix, durable], system: 'policy' })))
  })

  it('preserves image ordering and bytes without manufacturing durable metadata', () => {
    const ref = imageRef()
    const input: RequestUserInput = { role: 'user', content: [
      { type: 'text', text: 'before' }, { type: 'image', attachment: ref }, { type: 'text', text: 'after' },
    ] }
    const durable = createUserMessage({ content: input.content, source: { kind: 'test' } })
    const actual = serializeRequestWithImages(request({ messages: [input] }), imageOptions([ref]))
    const expected = serializeRequestWithImages(request({ messages: [durable] }), imageOptions([ref]))
    expect(actual).toEqual(expected)
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('source')
  })
})

describe('serializeMessages', () => {
  it('maps user text to string content', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'system-prompt' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('passes reasoning_content back on tool-call-free turns', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: MODEL_SOURCE,
      }),
    ])
    // A gateway that re-encodes the conversation for another vendor recovers
    // the upstream thinking signature by hashing this exact text, and a turn
    // that called no tool carries it nowhere else.
    expect(wire).toEqual([{ role: 'assistant', content: 'answer', reasoning_content: 'thinking…' }])
  })

  it('passes reasoning_content back on tool-call turns (official passback rule)', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: ToolCallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: MODEL_SOURCE,
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      // "" (not null) on tool-call turns — mirrors the official samples'
      // verbatim message replay; some gateways reject null.
      content: '',
      reasoning_content: 'I should check the weather.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('serializes parallel tool calls in order', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: ToolCallId('a'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: ToolCallId('b'), name: 'two', arguments: '{}' },
        ],
        source: MODEL_SOURCE,
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'two', arguments: '{}' } },
      ],
    }])
  })

  it('turns tool messages into role:tool wire messages', () => {
    const wire = serializeMessages([
      createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'Sunny 22C' }],
        isError: false,
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: 'Sunny 22C' }])
  })

  it('sends a sentinel for empty tool content', () => {
    const wire = serializeMessages([
      createToolResultMessage({ callId: ToolCallId('call-1'), content: [], isError: false }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: '(no output)' }])
  })

  it('keeps user text and tool messages as separate wire messages', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'context note' }],
        source: { kind: 'test' },
      }),
      createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'context note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('skips plugin-added block types (merge-extensible ContentBlockMap)', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'plugin:chart', data: 'x' },
          { type: 'text', text: 'see chart' },
        ],
        source: { kind: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'see chart' }])
  })

  it('rejects image blocks instead of silently flattening them away', () => {
    expect(() => serializeMessages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef('image/png', 68) }],
      source: { kind: 'test' },
    })])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('emits an empty user message rather than dropping block-less messages', () => {
    const wire = serializeMessages([createUserMessage({
      content: [],
      source: { kind: 'test' },
    })])
    expect(wire).toEqual([{ role: 'user', content: '' }])
  })
})

describe('roles the route cannot represent', () => {
  it('refuses developer history on the text and image paths before reading attachments', () => {
    const message = createDeveloperMessage({
      content: [{ type: 'tool-addition', toolName: 'search' }],
      source: { kind: 'test' },
    })
    const failure = {
      code: 'UNSUPPORTED_CONTENT',
      message: 'The DeepSeek chat-completions adapter cannot represent a developer message.',
    }
    expect(() => serializeMessages([message])).toThrow(expect.objectContaining(failure))
    expect(() => serializeMessagesWithImages([message], imageOptions([]))).toThrow(expect.objectContaining(failure))
    expect(() => serializeRequestWithImages(request({ messages: [message] }), imageOptions([])))
      .toThrow(expect.objectContaining(failure))
  })

  it('fails loudly on a message role outside the closed role map', () => {
    const stray = { role: 'narrator', content: [] } as never
    expect(() => serializeMessages([stray])).toThrow('unreachable variant in message role')
    expect(() => serializeMessagesWithImages([stray], imageOptions([]))).toThrow('unreachable variant in message role')
  })
})

describe('serializeRequest', () => {
  const history: Message[] = [createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'test' },
  })]

  it('always streams with usage and maps the basics', () => {
    const wire = serializeRequest(request({ messages: history }))
    expect(wire).toEqual({
      model: 'company-vision',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('prepends the system prompt', () => {
    const wire = serializeRequest(request({ messages: history, system: 'be helpful' }))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(wire.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('serializes a leading system message byte-for-byte like the same prompt passed as options.system', () => {
    const systemMessage = createMessage({
      role: 'system',
      content: [{ type: 'text', text: 'be helpful' }],
      source: { kind: 'system-prompt' },
    })
    const tools = [{ name: 'f', description: 'F', parameters: { type: 'object', properties: {} } }]
    const fromHistory = serializeRequest(request({ messages: [systemMessage, ...history], tools }))
    const fromOption = serializeRequest(request({ messages: history, system: 'be helpful', tools }))
    expect(fromHistory.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(JSON.stringify(fromHistory)).toBe(JSON.stringify(fromOption))
    const images = imageOptions([])
    const imageHistory = serializeRequestWithImages(request({ messages: [systemMessage, ...history], tools }), images)
    const imageOption = serializeRequestWithImages(request({ messages: history, system: 'be helpful', tools }), images)
    expect(JSON.stringify(imageHistory)).toBe(JSON.stringify(imageOption))
  })

  it('maps sampling params and stop sequences', () => {
    const wire = serializeRequest(request({ messages: history, temperature: 0.2, maxTokens: 100, stop: ['END'] }))
    expect(wire.temperature).toBe(0.2)
    expect(wire.max_tokens).toBe(100)
    expect(wire.stop).toEqual(['END'])
  })

  it('maps tools to the wire function fields', () => {
    const wire = serializeRequest(request({
      messages: history,
      tools: [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } },
      ],
    }))
    expect(wire.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ])
  })

  it('omits an empty tools array', () => {
    const wire = serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it.each(['low', 'high', 'max'] as const)('maps adapter-default thinking and request effort %s', (effort) => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId(effort) }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe(effort)
  })

  it('maps off to disabled thinking without a wire reasoning effort', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', () => {
    expect(() => serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })

  it('disables thinking for session-title requests without changing adapter defaults', () => {
    const wire = serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', () => {
    const wire = serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', () => {
    const wire = serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', () => {
    expect(() => serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })
})

describe('image serialization', () => {
  it('keeps text and image parts in their original order', () => {
    const ref = imageRef()
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', attachment: ref },
          { type: 'text', text: 'after' },
        ],
        source: { kind: 'test' },
      })],
    }), imageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'text', text: expect.stringContaining(`\nImage ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: 'after' },
      ],
    }])
  })

  it.each([
    ['image/png', 'data:image/png;base64,AAAA'],
    ['image/jpeg', 'data:image/jpeg;base64,AAAA'],
    ['image/webp', 'data:image/webp;base64,AAAA'],
    ['image/gif', 'data:image/gif;base64,AAAA'],
  ] as const)('serializes every retained %s request version as an inline data URL', (mediaType, url) => {
    const ref = imageRef(mediaType)
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'test' },
      })],
    }), imageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'image_url', image_url: { url } },
      ],
    }])
  })

  it('gives image-only input a stable handle and request dimensions', () => {
    const ref = imageRef()
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'test' },
      })],
    }), imageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Image ${ref.attachmentId}; request preview 1x1px. It may be resized or re-encoded; source dimensions, format, and byte size may differ.`,
        },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }])
  })

  it('includes provider-resolved normalized access in a retained image handle', () => {
    const ref = { ...imageRef(), name: 'diagram.png', width: 2048, height: 1024 }
    const images = imageOptions([ref])
    const version = images.requestImages.get(ref.attachmentId)
    if (version === undefined) throw new Error('expected a prepared request version')
    version.width = 1130
    version.height = 565
    images.resolveImageAccess = () => ({ readonlyPath: '/tmp/dsh/objects/aa/object' })
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [{
        type: 'text',
        text: expect.stringContaining('Image "diagram.png"') as string,
      }, { type: 'image_url' }],
    })
    expect(JSON.stringify(wire.messages[0])).toContain('/tmp/dsh/objects/aa/object')
    expect(JSON.stringify(wire.messages[0])).toContain('request preview 1130x565px')
  })

  it('rejects an image whose prepared request version is absent', () => {
    expect(() => serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'test' },
    })], imageOptions([]))).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }))
  })

  it('keeps tool content textual and groups consecutive tool-message images afterward', () => {
    const png = imageRef()
    const jpeg = imageRef('image/jpeg')
    const messages = [
      createToolResultMessage({
        callId: ToolCallId('first'),
        content: [{ type: 'image', attachment: png }],
        isError: false,
      }),
      createToolResultMessage({
        callId: ToolCallId('second'),
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image', attachment: jpeg },
        ],
        isError: false,
      }),
    ]

    expect(serializeMessagesWithImages(messages, imageOptions([png, jpeg]))).toEqual([
      {
        role: 'tool',
        tool_call_id: 'first',
        content: expect.stringContaining(`Image ${png.attachmentId}`) as string,
      },
      {
        role: 'tool',
        tool_call_id: 'second',
        content: expect.stringContaining(`caption\nImage ${jpeg.attachmentId}`) as string,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
        ],
      },
    ])
  })

  it('keeps an empty user message for ignored content beside a tool message', () => {
    const messages = [
      createUserMessage({
        content: [
          { type: 'text', text: '' },
          { type: 'plugin:chart', data: 'ignored' },
        ],
        source: { kind: 'test' },
      }),
      createToolResultMessage({
        callId: ToolCallId('result'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    ]

    expect(serializeMessagesWithImages(messages, imageOptions([]))).toEqual([
      { role: 'user', content: '' },
      { role: 'tool', tool_call_id: 'result', content: 'ok' },
    ])
  })

  it('converts consecutive tool messages and preserves the empty fallback', () => {
    const messages = [
      createToolResultMessage({
        callId: ToolCallId('nested'),
        content: [{ type: 'text', text: 'inside' }],
        isError: false,
      }),
      createToolResultMessage({ callId: ToolCallId('empty'), content: [], isError: false }),
    ]

    expect(serializeMessagesWithImages(messages, imageOptions([]))).toEqual([
      { role: 'tool', tool_call_id: 'nested', content: 'inside' },
      { role: 'tool', tool_call_id: 'empty', content: '(no output)' },
    ])
  })

  it('flushes tool-message images before system, assistant, and user history', () => {
    const imageResult = (id: string) => createToolResultMessage({
      callId: ToolCallId(id),
      content: [{ type: 'image', attachment: imageRef() }],
      isError: false,
    })
    const messages: RequestMessage[] = [
      imageResult('before-system'),
      createMessage({
        role: 'system',
        content: [{ type: 'text', text: 'system history' }],
        source: { kind: 'system-prompt' },
      }),
      imageResult('before-assistant'),
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant history' }],
        source: MODEL_SOURCE,
      }),
      imageResult('before-user'),
      createUserMessage({ content: [{ type: 'text', text: 'user history' }], source: { kind: 'test' } }),
    ]

    const attached = {
      role: 'user',
      content: [
        { type: 'text', text: 'Attached image(s) from tool result:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }
    const toolMessage = (id: string) => ({
      role: 'tool',
      tool_call_id: id,
      content: expect.stringContaining('request preview 1x1px') as string,
    })
    expect(serializeMessagesWithImages(messages, imageOptions([imageRef()]))).toEqual([
      toolMessage('before-system'),
      attached,
      { role: 'system', content: 'system history' },
      toolMessage('before-assistant'),
      attached,
      { role: 'assistant', content: 'assistant history' },
      toolMessage('before-user'),
      attached,
      { role: 'user', content: 'user history' },
    ])
  })

  it('projects surface-offloaded occurrences to placeholders without preparing them', () => {
    const png = imageRef('image/png', 3)
    const jpeg = imageRef('image/jpeg', 3)
    // Only the retained jpeg is prepared; its three bytes encode to four base64 bytes.
    const images = imageOptions([jpeg], 4, 4)
    images.resolveImageAccess = ref => ref.mediaType === 'image/png'
      ? { readonlyPath: '/tmp/dsh/objects/png' }
      : undefined
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [
          { type: 'image', attachment: png, offloaded: true },
          { type: 'image', attachment: jpeg },
        ],
        source: { kind: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`image omitted to fit request image limits; ${png.attachmentId}. Normalized copy (read-only; may be resized or re-encoded): "/tmp/dsh/objects/png"`) as string,
        },
        { type: 'text', text: expect.stringContaining(`Image ${jpeg.attachmentId}`) as string },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    })
  })

  it('removes whole oldest occurrences past the byte bound when no byte quantum is configured', () => {
    const ref = imageRef('image/png', 3)
    // Three retained images encode to 12 base64 bytes against a 5-byte bound: two must go.
    expect(() => serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: Array.from({ length: 3 }, () => ({ type: 'image' as const, attachment: ref })),
        source: { kind: 'test' },
      })],
    }), imageOptions([ref], 5))).toThrow(expect.objectContaining({
      code: 'IMAGE_OFFLOAD_REQUIRED',
      failure: expect.objectContaining({ offloadImages: 2 }),
    }))
  })

  it('rejects retained inline images beyond the bound with the quantized count to offload', () => {
    const ref = imageRef('image/png', 3)
    // 21 retained 3-byte images encode to 84 base64 bytes against an 80-byte bound with a
    // 40-byte quantum: the removal crosses the quantum at the eleventh oldest occurrence.
    expect(() => serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: Array.from({ length: 21 }, () => ({ type: 'image' as const, attachment: ref })),
        source: { kind: 'test' },
      })],
    }), imageOptions([ref], 80, 40))).toThrow(expect.objectContaining({
      code: 'IMAGE_OFFLOAD_REQUIRED',
      message: 'DeepSeek base64 request images exceed the route budget; 11 more oldest occurrence(s) must be offloaded.',
      failure: expect.objectContaining({ offloadImages: 11 }),
    }))
  })

  it('applies the configured image-count quantum', () => {
    const ref = imageRef()
    const messages = [createUserMessage({
      content: Array.from({ length: 3 }, () => ({ type: 'image' as const, attachment: ref })),
      source: { kind: 'test' },
    })]
    expect(() => serializeRequestWithImages(request({ messages }), {
      ...imageOptions([ref]), maxImagesPerRequest: 2, countQuantum: 2,
    })).toThrow(expect.objectContaining({ code: 'IMAGE_OFFLOAD_REQUIRED', failure: expect.objectContaining({ offloadImages: 2 }) }))
  })

  it('counts only retained occurrences against the bound', () => {
    const ref = imageRef('image/png', 3)
    const wire = serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [
          ...Array.from({ length: 11 }, () => ({ type: 'image' as const, attachment: ref, offloaded: true as const })),
          ...Array.from({ length: 10 }, () => ({ type: 'image' as const, attachment: ref })),
        ],
        source: { kind: 'test' },
      })],
    }), imageOptions([ref], 80, 40))
    const content = wire.messages[0]?.content
    expect(JSON.stringify(content).match(/image omitted to fit request image limits/g)).toHaveLength(11)
    expect(JSON.stringify(content).match(/"type":"image_url"/g)).toHaveLength(10)
  })

  it('rejects an unprepared image while computing exact request bytes', () => {
    expect(() => serializeRequestWithImages(request({
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: imageRef() }],
        source: { kind: 'test' },
      })],
    }), imageOptions([]))).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }))
  })

  it.each(['system', 'assistant'] as const)('rejects an image in %s history', (role) => {
    const content: ContentBlock[] = [{ type: 'image', attachment: imageRef() }]
    const message = role === 'system'
      ? createMessage({ role, content, source: { kind: 'system-prompt' } })
      : createMessage({ role, content, source: MODEL_SOURCE })
    expect(() => serializeMessagesWithImages([message], imageOptions([imageRef()])))
      .toThrow(expect.objectContaining({
        code: 'UNSUPPORTED_CONTENT',
        message: `The DeepSeek chat-completions adapter cannot represent image content in a ${role} message.`,
      }))
  })

  it('rejects unsupported image history before request offloading can replace it', () => {
    expect(() => serializeRequestWithImages(request({
      messages: [createMessage({
        role: 'system',
        content: [{ type: 'image', attachment: imageRef('image/png', 300) }],
        source: { kind: 'system-prompt' },
      })],
    }), imageOptions([imageRef('image/png', 300)], 1, 1)))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('prepends the request system prompt on the image path', () => {
    const ref = imageRef()
    const wire = serializeRequestWithImages(request({
      system: 'system prompt',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'test' },
      })],
    }), imageOptions([ref]))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'system prompt' })
  })
})

describe('assistant content fields', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', () => {
    // Aborted/empty assistant turns: no text, no calls → "". The API rejects
    // a null-content assistant message without tool_calls with HTTP 400
    // ("content or tool_calls must be set").
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: MODEL_SOURCE,
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content beside its reasoning', () => {
    // The model can answer entirely in the reasoning channel. Content must
    // still be set: a null here would poison the session log and fail every
    // later turn of that session.
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: MODEL_SOURCE,
    })])
    expect(wire).toEqual([{
      role: 'assistant', content: '', reasoning_content: '你好！有什么我可以帮你的吗？',
    }])
  })
})
