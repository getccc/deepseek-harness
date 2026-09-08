import { describe, expect, it } from 'vitest'
import { deploymentPatch, resolveDeployment } from '../src/deployment.ts'
import { profileManifest } from '../src/profile.ts'
import { runnerReady } from '../src/readiness.ts'

const facts = {
  controlPlaneUrl: 'https://control.acme.example/path',
  runnerVersion: '2.4.1',
  callbackUrl: 'http://127.0.0.1:3090/team/callback',
  locale: 'en-US',
} as const

describe('desktop deployment facts', () => {
  it('writes the Control Plane into every Runner consumer without secret material', () => {
    const deployment = resolveDeployment(facts)
    const patch = JSON.parse(deploymentPatch(deployment)) as Record<string, unknown>[]
    expect(patch).toMatchObject([
      { id: 'team-account-client', config: {
        controlPlaneUrl: 'https://control.acme.example', runnerVersion: '2.4.1',
      } },
      { id: 'team-local-login', config: { locale: 'en-US' } },
      { id: 'llm-http-transport', config: { controlPlaneUrl: 'https://control.acme.example' } },
      // Knowledge takes the same origin from the same deployment fact: the
      // installer is the one place a build learns which company it belongs to.
      { id: 'knowledge', config: { controlPlaneUrl: 'https://control.acme.example' } },
    ])
    expect(deploymentPatch(deployment)).not.toMatch(/weknora|knowledgeBase|apiKey/iu)
    expect(deploymentPatch(deployment)).not.toMatch(/password|credential/iu)
  })

  it('accepts local HTTP only for development and fixes the callback origin', () => {
    expect(() => resolveDeployment({ ...facts, controlPlaneUrl: 'http://control.acme.example' }))
      .toThrow(/HTTPS/u)
    expect(() => resolveDeployment({ ...facts, callbackUrl: 'http://127.0.0.1:3091/team/callback' }))
      .toThrow(/fixed Runner origin/u)
  })

  it('pins a private certificate authority on every Control Plane consumer', () => {
    const patch = JSON.parse(deploymentPatch(resolveDeployment({
      ...facts, controlPlaneCa: '/opt/welinkin/control-plane-ca.crt', locale: 'zh-CN',
    }))) as { id: string; config: Record<string, unknown> }[]
    const pinned = patch.filter(row => row.config['controlPlaneCa'] === '/opt/welinkin/control-plane-ca.crt')
    expect(pinned.map(row => row.id)).toEqual(['team-account-client', 'llm-http-transport', 'knowledge'])
    expect(patch[1]?.config).toMatchObject({ locale: 'zh-CN' })
  })

  it('rejects a certificate path the Runner would resolve against its own working directory', () => {
    expect(() => resolveDeployment({ ...facts, controlPlaneCa: 'control-plane-ca.crt' }))
      .toThrow(/absolute path/u)
    expect(() => resolveDeployment({ ...facts, controlPlaneCa: String.raw`C:control-plane-ca.crt` }))
      .toThrow(/absolute path/u)
    expect(() => resolveDeployment({ ...facts, controlPlaneCa: String.raw`\control-plane-ca.crt` }))
      .toThrow(/absolute path/u)
  })

  it('accepts fully qualified Windows deployment paths', () => {
    const controlPlaneCa = String.raw`C:\Program Files\Welinkin Work\resources\runner\control-plane-ca.crt`
    const welinkinTemplatePath = String.raw`C:\Program Files\Welinkin Work\resources\runner\WELINKIN-PPT.pptx`
    expect(resolveDeployment({ ...facts, controlPlaneCa, welinkinTemplatePath })).toMatchObject({
      controlPlaneCa,
      welinkinTemplatePath,
    })
  })

  it('omits the pin entirely for a publicly trusted Control Plane', () => {
    expect(deploymentPatch(resolveDeployment(facts))).not.toMatch(/controlPlaneCa/u)
  })
})

describe('desktop profile composition', () => {
  it('layers the shipped plugins over the Runner-carried bundles', () => {
    const manifest = JSON.parse(profileManifest(true)) as {
      dsh: { profile: { bundles: string[]; patchReload: string } }
    }
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-team',
      'dsh-univer-office',
      'dsh-better-sidebar',
      '@huanlin/dsh-plugin-better-sidebar-plugin-office',
      '@dsh-external/dsh-echarts',
    ])
    expect(manifest.dsh.profile.patchReload).toBe('live')
  })

  it('names only resolvable bundles when a build carried no plugin tree', () => {
    const manifest = JSON.parse(profileManifest(false)) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-team',
    ])
  })
})

describe('runner readiness', () => {
  it('waits through the pre-mount 404 and accepts the login redirect, the route refusal, or a signed-in page', () => {
    // The Runner binds its port before the login route mounts and answers 404
    // with an empty body in between; loading that page left a blank window.
    expect(runnerReady(404)).toBe(false)
    expect(runnerReady(500)).toBe(false)
    expect(runnerReady(303)).toBe(true)
    expect(runnerReady(405)).toBe(true)
    expect(runnerReady(200)).toBe(true)
  })
})
