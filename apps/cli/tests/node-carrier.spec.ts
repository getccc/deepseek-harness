import { describe, expect, it } from 'vitest'
import { carriedScript } from '../src/node-carrier.ts'

const present = new Set(['/plugins/dsh-univer-office/artifacts/gateway.cjs', '/tmp/worker.mjs'])
const exists = (path: string): boolean => present.has(path)

describe('packaged executable as a child Node', () => {
  it('runs the worker a plugin spawned through process.execPath', () => {
    expect(carriedScript(['/plugins/dsh-univer-office/artifacts/gateway.cjs', '--port', '0'], exists))
      .toBe('/plugins/dsh-univer-office/artifacts/gateway.cjs')
    expect(carriedScript(['/tmp/worker.mjs'], exists)).toBe('/tmp/worker.mjs')
  })

  it('leaves every dsh invocation to the launcher', () => {
    expect(carriedScript(['--profile', 'team'], exists)).toBeUndefined()
    expect(carriedScript(['web'], exists)).toBeUndefined()
    expect(carriedScript([], exists)).toBeUndefined()
  })

  it('refuses a missing file, a relative path, and a non-script', () => {
    expect(carriedScript(['/tmp/absent.js'], exists)).toBeUndefined()
    expect(carriedScript(['worker.mjs'], exists)).toBeUndefined()
    expect(carriedScript(['/tmp/notes.md'], () => true)).toBeUndefined()
  })
})
