/**
 * The service definitions an installer writes.
 *
 * These are documents three different service managers read, so the tests
 * assert the facts that change how a Runner behaves — which account it runs
 * as, whether it restarts, and how fast — rather than the exact text.
 */

import { describe, expect, it } from 'vitest'
import {
  SERVICE_LABEL,
  launchdPlist,
  serviceDefinitionFor,
  systemdUnit,
  windowsTaskDefinition,
  type ServiceDefinition,
} from '../src/index.ts'

const definition: ServiceDefinition = {
  executable: '/usr/local/bin/dsh',
  arguments: ['--profile', 'team'],
  dshHome: '/Users/alice/.dsh',
  logPath: '/Users/alice/.dsh/runner.log',
}

describe('every platform', () => {
  it('runs as the member, never with elevated rights', () => {
    // The Runner executes the member's own work with the member's own
    // permissions; a daemon or a system service would run it as root.
    expect(launchdPlist(definition)).not.toContain('LaunchDaemon')
    expect(systemdUnit(definition)).toContain('WantedBy=default.target')
    expect(systemdUnit(definition)).not.toContain('multi-user.target')
    expect(windowsTaskDefinition(definition)).toContain('<RunLevel>LeastPrivilege</RunLevel>')
    expect(windowsTaskDefinition(definition)).toContain('<LogonType>InteractiveToken</LogonType>')
  })

  it('restarts a crash, and bounds how fast it retries', () => {
    // Without the bound, a Runner that cannot start spins against the service
    // manager instead of failing visibly.
    expect(launchdPlist(definition)).toContain('<key>KeepAlive</key><true/>')
    expect(launchdPlist(definition)).toContain('<key>ThrottleInterval</key><integer>10</integer>')
    expect(systemdUnit(definition)).toContain('Restart=always')
    expect(systemdUnit(definition)).toContain('RestartSec=10')
    expect(windowsTaskDefinition(definition)).toContain('<Interval>PT10S</Interval>')
  })

  it('carries the DSH home, so a service started from anywhere finds its data', () => {
    expect(launchdPlist(definition)).toContain('/Users/alice/.dsh')
    expect(systemdUnit(definition)).toContain('Environment=DSH_HOME=/Users/alice/.dsh')
  })

  it('shares one label, so a person finds the same name on any platform', () => {
    for (const document of [launchdPlist(definition), windowsTaskDefinition(definition)]) {
      expect(document).toContain(SERVICE_LABEL)
    }
  })
})

describe('values that carry markup or spaces', () => {
  it('escapes a path that would otherwise close a tag', () => {
    const hostile: ServiceDefinition = {
      ...definition,
      executable: '/opt/dsh & co/<bin>/dsh',
      logPath: '/tmp/"quoted".log',
    }
    for (const document of [launchdPlist(hostile), windowsTaskDefinition(hostile)]) {
      expect(document).toContain('&amp;')
      expect(document).not.toContain('<bin>')
    }
  })

  it('quotes an argument with a space, so the command stays one word per argument', () => {
    const spaced: ServiceDefinition = { ...definition, arguments: ['--profile', 'team edition'] }
    expect(systemdUnit(spaced)).toContain('"team edition"')
    // The Windows document quotes the argument and then escapes the quotes,
    // because the quoting is for the command line and the escaping is for XML.
    expect(windowsTaskDefinition(spaced)).toContain('&quot;team edition&quot;')
  })
})

describe('choosing a definition', () => {
  it('names each platform its own file and format', () => {
    expect(serviceDefinitionFor('darwin', definition).filename).toBe(`${SERVICE_LABEL}.plist`)
    expect(serviceDefinitionFor('darwin', definition).document).toContain('<!DOCTYPE plist')
    expect(serviceDefinitionFor('linux', definition).filename).toBe(`${SERVICE_LABEL}.service`)
    expect(serviceDefinitionFor('linux', definition).document).toContain('[Unit]')
    expect(serviceDefinitionFor('win32', definition).filename).toBe(`${SERVICE_LABEL}.xml`)
    expect(serviceDefinitionFor('win32', definition).document).toContain('<Task version=')
  })
})
