/**
 * What the team transport sends, and what it does not.
 *
 * The Control Plane here is a recording server rather than the real one: the
 * end-to-end path is covered where the endpoint lives, and what is worth
 * proving on this side is exactly what leaves the Runner.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TransportFailedError, type LlmHttpTransport } from '@deepseek-ai/dsh-llm-http-transport'
import { NotBoundError } from '@deepseek-ai/dsh-team-account-client'
import TeamLlmHttpTransport, { currentPeriod } from '../src/index.ts'

/** What the Control Plane saw. */
interface Seen {
  path: string | undefined
  authorization: string | undefined
  body: Record<string, unknown>
}

let plane: Server
let seen: Seen[]
let answer: (res: ServerResponse) => void
let ctx: Context
let transport: LlmHttpTransport

/** A Control Plane that records each request and answers however a test says. */
async function startPlane(): Promise<string> {
  seen = []
  answer = (res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [] }))
  }
  plane = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      seen.push({
        path: req.url,
        authorization: req.headers.authorization,
        body: chunks.length === 0
          ? {}
          : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      answer(res)
    })
  })
  plane.listen(0, '127.0.0.1')
  await once(plane, 'listening')
  return `http://127.0.0.1:${String((plane.address() as { port: number }).port)}`
}

/** Read a response body stream to the end. */
async function textOf(body: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Mount the transport over an account client that answers however a test says. */
async function mount(origin: string, accessToken: () => Promise<string>): Promise<LlmHttpTransport> {
  ctx = new Context()
  ctx.provide('teamAccountClient', { accessToken })
  await ctx.plugin(TeamLlmHttpTransport, { controlPlaneUrl: origin }).await()
  return ctx.get('llmHttpTransport') as LlmHttpTransport
}

beforeEach(async () => {
  const origin = await startPlane()
  transport = await mount(origin, () => Promise.resolve('an-access-token'))
})

afterEach(async () => {
  await ctx.fiber.dispose()
  plane.close()
})

describe('what leaves the Runner', () => {
  it('reads only the model refs, names, and input modalities the Control Plane exposes', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        models: [{ modelRef: 'company-v4', displayName: 'Company V4', inputModalities: ['text', 'image'] }],
      }))
    }

    await expect(transport.listModels()).resolves.toEqual([
      { id: 'company-v4', name: 'Company V4', inputModalities: ['text', 'image'] },
    ])
    expect(seen[0]).toMatchObject({
      path: '/team/model/catalog',
      authorization: 'Bearer an-access-token',
      body: {},
    })
  })

  it.each([
    ['a ref that is not a string', { modelRef: 7, displayName: 'Company V4', inputModalities: ['text'] }],
    ['no modality list', { modelRef: 'company-v4', displayName: 'Company V4' }],
    ['an empty modality list', { modelRef: 'company-v4', displayName: 'Company V4', inputModalities: [] }],
    // A word this Runner does not carry is a newer Control Plane, and the
    // answer is a malformed catalog rather than a guess at what it meant.
    ['a modality this build does not carry', { modelRef: 'company-v4', displayName: 'Company V4', inputModalities: ['text', 'audio'] }],
  ])('refuses a model catalog with %s at the HTTP wire', async (_case, model) => {
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ models: [model] }))
    }

    await expect(transport.listModels()).rejects.toMatchObject({
      reason: 'refused', detail: 'model catalog response is malformed',
    })
  })

  it('sends the operation, the model, and the body — and no address', async () => {
    await transport.send({
      operation: 'chat.completions',
      modelRef: 'company-v4',
      body: { model: 'company-v4', messages: [{ role: 'user', content: 'hi' }] },
      inputTokens: 500,
    })
    const request = seen[0] as Seen
    expect(request.path).toBe('/team/model/invoke')
    expect(request.authorization).toBe('Bearer an-access-token')
    expect(request.body).toMatchObject({
      operation: 'chat.completions',
      modelRef: 'company-v4',
      inputTokens: 500,
      period: currentPeriod(),
    })
    // Nothing about where the call goes, and no upstream credential: the
    // request has no place for either.
    const wire = JSON.stringify(request.body)
    expect(wire).not.toContain('http')
    expect(wire).not.toContain('endpoint')
    expect(wire).not.toContain('apiKey')
  })

  it('carries the optional facts only when the adapter supplied them', async () => {
    await transport.send({
      operation: 'chat.completions', modelRef: 'company-v4', body: {}, inputTokens: 1,
    })
    expect('maxOutputTokens' in (seen[0] as Seen).body).toBe(false)
    expect('correlationId' in (seen[0] as Seen).body).toBe(false)

    await transport.send({
      operation: 'chat.completions', modelRef: 'company-v4', body: {}, inputTokens: 1,
      maxOutputTokens: 256, correlationId: 'c-9f2a',
    })
    expect((seen[1] as Seen).body).toMatchObject({ maxOutputTokens: 256, correlationId: 'c-9f2a' })
  })

  it('reads the access token per call, so a refreshed one is the one that is sent', async () => {
    let issued = 0
    const rotating = await mount(
      `http://127.0.0.1:${String((plane.address() as { port: number }).port)}`,
      () => { issued += 1; return Promise.resolve(`token-${String(issued)}`) },
    )
    await rotating.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 })
    await rotating.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 })
    expect((seen[0] as Seen).authorization).toBe('Bearer token-1')
    expect((seen[1] as Seen).authorization).toBe('Bearer token-2')
  })
})

describe('what comes back', () => {
  it('hands the answer through as a stream rather than a buffer', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }
    const response = await transport.send({
      operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1,
    })
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(await textOf(response.body)).toContain('[DONE]')
  })

  it('passes a refusal through rather than translating it', async () => {
    answer = (res) => {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'refused', reason: 'quota-exceeded' }))
    }
    const response = await transport.send({
      operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1,
    })
    // The adapter that built the request is the one that can read the answer.
    expect(response.status).toBe(403)
    expect((JSON.parse(await textOf(response.body)) as { reason: string }).reason).toBe('quota-exceeded')
  })

  it('answers an empty body with an empty stream', async () => {
    answer = (res) => {
      res.writeHead(204)
      res.end()
    }
    const response = await transport.send({
      operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1,
    })
    expect(response.status).toBe(204)
    expect(await textOf(response.body)).toBe('')
  })
})

describe('when it cannot carry the request', () => {
  it('tells a member to connect this computer, not to ask an administrator', async () => {
    const unbound = await mount(
      `http://127.0.0.1:${String((plane.address() as { port: number }).port)}`,
      () => Promise.reject(new NotBoundError()),
    )
    await expect(unbound.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 }))
      .rejects.toMatchObject({ name: 'TransportFailedError', reason: 'not-bound' })
  })

  it('separates a refused credential from an unbound computer', async () => {
    const refused = await mount(
      `http://127.0.0.1:${String((plane.address() as { port: number }).port)}`,
      () => Promise.reject(new Error('the family was revoked')),
    )
    await expect(refused.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 }))
      .rejects.toMatchObject({ reason: 'refused' })
  })

  it('carries an abort signal, so cancelling the request cancels the call', async () => {
    answer = () => {
      // Never answers: the only way out is the caller's own signal.
    }
    const controller = new AbortController()
    const pending = transport.send({
      operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1,
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it('reports an unreachable Control Plane as its own failure', async () => {
    const nowhere = await mount('http://127.0.0.1:1', () => Promise.resolve('t'))
    await expect(nowhere.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 }))
      .rejects.toBeInstanceOf(TransportFailedError)
    await expect(nowhere.send({ operation: 'chat.completions', modelRef: 'm', body: {}, inputTokens: 1 }))
      .rejects.toMatchObject({ reason: 'unreachable' })
  })
})

describe('the budget period', () => {
  it('is the UTC month, so two time zones spend the same one', () => {
    expect(currentPeriod()).toMatch(/^\d{4}-\d{2}$/u)
    const now = new Date()
    expect(currentPeriod())
      .toBe(`${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
  })
})
