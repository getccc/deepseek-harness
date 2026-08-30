/**
 * The background service definition an installer writes, for each platform's
 * service manager.
 *
 * These are pure renderings of one description into three formats. Writing the
 * file, loading it, and removing it belong to the installer, which runs with
 * the privileges and the platform knowledge this package does not have — but
 * *what* gets written is a product decision, and it is stated once here rather
 * than three times in three installers.
 * @module @deepseek-ai/dsh-team-update/service
 */

import type { UpdatePlatform } from './manifest.ts'

/** The service label, identical across platforms so a person finds it. */
export const SERVICE_LABEL = 'com.deepseek.dsh.runner'

/** What the service manager needs to know to run a Team Runner. */
export interface ServiceDefinition {
  /** Absolute path to the executable the service manager launches. */
  readonly executable: string
  /** Arguments after the executable, in order. */
  readonly arguments: readonly string[]
  /** The DSH home this Runner uses, passed through the environment. */
  readonly dshHome: string
  /** Absolute path the service writes its own log to. */
  readonly logPath: string
}

/** Escape text for an XML text node or attribute value. */
function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * The launchd property list for the current user's LaunchAgents directory.
 *
 * A LaunchAgent rather than a LaunchDaemon: the Runner executes the member's
 * own work with the member's own permissions, and a daemon would run it as
 * root. `KeepAlive` restarts a crash and `ThrottleInterval` bounds how fast,
 * so a Runner that cannot start does not spin.
 * @param definition - what the service manager launches.
 * @returns the plist document.
 */
export function launchdPlist(definition: ServiceDefinition): string {
  const argv = [definition.executable, ...definition.arguments]
    .map(value => `    <string>${xml(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>DSH_HOME</key><string>${xml(definition.dshHome)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(definition.logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(definition.logPath)}</string>
</dict>
</plist>
`
}

/**
 * The systemd unit for the current user's units directory.
 *
 * A user unit rather than a system one, for the same reason launchd gets an
 * agent. `Restart=always` with `RestartSec` matches the launchd throttle, and
 * the unit is wanted by `default.target` so it starts when the member logs in.
 * @param definition - what the service manager launches.
 * @returns the unit file.
 */
export function systemdUnit(definition: ServiceDefinition): string {
  const command = [definition.executable, ...definition.arguments]
    .map(value => (/[\s"']/u.test(value) ? JSON.stringify(value) : value))
    .join(' ')
  return `[Unit]
Description=DeepSeek Harness Team Runner
After=network-online.target

[Service]
Type=simple
ExecStart=${command}
Environment=DSH_HOME=${definition.dshHome}
Restart=always
RestartSec=10
StandardOutput=append:${definition.logPath}
StandardError=append:${definition.logPath}

[Install]
WantedBy=default.target
`
}

/**
 * The Windows Task Scheduler definition, registered for the current user.
 *
 * Task Scheduler rather than a Windows service: a service runs in session 0
 * with no access to the member's desktop session, and the Runner belongs to
 * the member's own login.
 * @param definition - what the service manager launches.
 * @returns the task XML document.
 */
export function windowsTaskDefinition(definition: ServiceDefinition): string {
  const args = definition.arguments
    .map(value => (/[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value))
    .join(' ')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\${xml(SERVICE_LABEL)}</URI>
    <Description>DeepSeek Harness Team Runner</Description>
  </RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT10S</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(definition.executable)}</Command>
      <Arguments>${xml(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

/**
 * Render the service definition for one platform.
 * @param platform - the platform whose service manager will read it.
 * @param definition - what the service manager launches.
 * @returns the document to write, and the filename convention for it.
 */
export function serviceDefinitionFor(
  platform: UpdatePlatform,
  definition: ServiceDefinition,
): { readonly filename: string; readonly document: string } {
  switch (platform) {
    case 'darwin':
      return { filename: `${SERVICE_LABEL}.plist`, document: launchdPlist(definition) }
    case 'linux':
      return { filename: `${SERVICE_LABEL}.service`, document: systemdUnit(definition) }
    case 'win32':
      return { filename: `${SERVICE_LABEL}.xml`, document: windowsTaskDefinition(definition) }
  }
}
