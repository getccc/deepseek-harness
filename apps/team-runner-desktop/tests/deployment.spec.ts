import { describe, expect, it } from 'vitest'
import { deploymentPatch, resolveDeployment } from '../src/deployment.ts'

describe('desktop deployment facts', () => {
  it('writes the Control Plane into every Runner consumer without secret material', () => {
    const deployment = resolveDeployment({
      controlPlaneUrl: 'https://control.acme.example/path',
      runnerVersion: '2.4.1',
      callbackUrl: 'http://127.0.0.1:3090/team/callback',
    })
    const patch = JSON.parse(deploymentPatch(deployment)) as Record<string, unknown>[]
    expect(patch).toMatchObject([
      { id: 'team-account-client', config: {
        controlPlaneUrl: 'https://control.acme.example', runnerVersion: '2.4.1',
      } },
      { id: 'llm-http-transport', config: { controlPlaneUrl: 'https://control.acme.example' } },
      // Knowledge takes the same origin from the same deployment fact: the
      // installer is the one place a build learns which company it belongs to.
      { id: 'knowledge', config: { controlPlaneUrl: 'https://control.acme.example' } },
    ])
    expect(deploymentPatch(deployment)).not.toMatch(/weknora|knowledgeBase|apiKey/iu)
    expect(deploymentPatch(deployment)).not.toMatch(/password|credential/iu)
  })

  it('accepts local HTTP only for development and fixes the callback origin', () => {
    expect(() => resolveDeployment({
      controlPlaneUrl: 'http://control.acme.example',
      runnerVersion: '2.4.1',
      callbackUrl: 'http://127.0.0.1:3090/team/callback',
    })).toThrow(/HTTPS/u)
    expect(() => resolveDeployment({
      controlPlaneUrl: 'https://control.acme.example',
      runnerVersion: '2.4.1',
      callbackUrl: 'http://127.0.0.1:3091/team/callback',
    })).toThrow(/fixed Runner origin/u)
  })
})
