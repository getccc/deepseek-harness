/** Company registry TLS settings owned by the desktop deployment. */
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pin one HTTPS registry's certificate authority without changing other npm settings or global TLS trust.
 * @param profile - existing package-manager directory of the Team profile.
 * @param registry - company HTTPS registry URL.
 * @param ca - absolute path of the deployment's PEM certificate authority.
 */
export function writeRegistryTrust(profile: string, registry: string, ca: string): void {
  const url = new URL(registry)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Company registry trust requires an HTTPS registry URL without credentials, query or fragment')
  }
  const key = `//${url.host}${url.pathname.replace(/\/?$/u, '/')}:cafile`
  const path = join(profile, '.npmrc')
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = previous.split(/\r?\n/u).filter(line => line.split('=', 1)[0]?.trim() !== key)
  while (lines.at(-1) === '') lines.pop()
  const next = `${[...lines, `${key}=${JSON.stringify(ca)}`].join('\n')}\n`
  if (next === previous) return
  const temporary = mkdtempSync(join(profile, '.registry-trust-'))
  try {
    const staged = join(temporary, '.npmrc')
    writeFileSync(staged, next, { mode: 0o600 })
    renameSync(staged, path)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
