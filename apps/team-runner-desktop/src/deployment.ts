import { posix, win32 } from 'node:path'

/** Deployment facts baked into one enterprise desktop build. */
export interface DesktopDeployment {
  readonly controlPlaneUrl: string
  /**
   * Absolute path of the certificate that signed the Control Plane's TLS
   * certificate. Node ignores the operating-system trust store, so a
   * deployment behind a private certificate authority is unreachable without
   * it; a deployment behind a publicly trusted certificate passes `undefined`.
   */
  readonly controlPlaneCa?: string
  readonly runnerVersion: string
  readonly callbackUrl: string
  /** Locale of the Runner-local login pages. */
  readonly locale: LoginLocale
  /**
   * Absolute path to the PowerPoint template the office picker's `ppt` kind
   * builds from, or undefined when the build carries none.
   */
  readonly welinkinTemplatePath?: string
  /**
   * Absolute path of the skill directory the installer staged, scanned beside
   * the member's own skill roots, or undefined when the build carries none.
   */
  readonly skillDir?: string
  /** Session-catalog skill names each office kind starts from; absent kinds name none. */
  readonly officeSkills?: OfficeSkills
}

/** The skill each office deliverable kind loads before building, by kind. */
export interface OfficeSkills {
  readonly ppt?: string
  readonly word?: string
  readonly excel?: string
}

/** The locales `dsh-team-local-login` renders. */
export type LoginLocale = 'en-US' | 'zh-CN'

function isFullyQualifiedPath(value: string): boolean {
  if (posix.isAbsolute(value)) return true
  return win32.isAbsolute(value) && win32.parse(value).root.length > 1
}

/**
 * Validate the non-secret deployment facts the desktop installer carries.
 * @param input - values read from packaged metadata and the application version.
 * @returns normalized facts suitable for the Team profile patch.
 */
export function resolveDeployment(input: DesktopDeployment): DesktopDeployment {
  const controlPlane = new URL(input.controlPlaneUrl)
  if (controlPlane.protocol !== 'https:'
    && !(controlPlane.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(controlPlane.hostname))) {
    throw new Error('the Team Control Plane must use HTTPS')
  }
  if (input.runnerVersion.trim() === '') throw new Error('the Runner version must not be empty')
  const callback = new URL(input.callbackUrl)
  if (callback.origin !== 'http://127.0.0.1:3090') {
    throw new Error('the Team callback must stay on the fixed Runner origin')
  }
  // A relative path would resolve against the Runner's working directory,
  // which the desktop shell does not own; the Runner reads the file itself.
  if (input.controlPlaneCa !== undefined && !isFullyQualifiedPath(input.controlPlaneCa)) {
    throw new Error('the Control Plane certificate authority must be an absolute path')
  }
  if (input.welinkinTemplatePath !== undefined && !isFullyQualifiedPath(input.welinkinTemplatePath)) {
    throw new Error('the PowerPoint template path must be absolute')
  }
  if (input.skillDir !== undefined && !isFullyQualifiedPath(input.skillDir)) {
    throw new Error('the staged skill directory must be an absolute path')
  }
  const officeSkills = Object.entries(input.officeSkills ?? {})
  if (officeSkills.some(([, skill]) => typeof skill !== 'string' || skill.trim() === '')) {
    throw new Error('an office skill name must not be empty')
  }
  // A named skill no staged directory carries would send every deliverable of
  // that kind to a catalog entry that cannot load.
  if (officeSkills.length > 0 && input.skillDir === undefined) {
    throw new Error('office skills need the staged skill directory that carries them')
  }
  return {
    controlPlaneUrl: controlPlane.origin,
    ...input.controlPlaneCa === undefined ? {} : { controlPlaneCa: input.controlPlaneCa },
    runnerVersion: input.runnerVersion,
    callbackUrl: callback.href,
    locale: input.locale,
    ...input.welinkinTemplatePath === undefined ? {} : { welinkinTemplatePath: input.welinkinTemplatePath },
    ...input.skillDir === undefined ? {} : { skillDir: input.skillDir },
    ...officeSkills.length === 0 ? {} : { officeSkills: input.officeSkills },
  }
}

/**
 * Render the deployment-owned profile patch consumed by the bundled `dsh`
 * executable. JSON is valid YAML and avoids quoting deployment-controlled text.
 * A patch replaces the targeted row's whole `config`, so each row restates
 * every key the `dsh-team` bundle set for it.
 * @param deployment - validated enterprise build facts.
 * @returns a Team profile patch document.
 */
export function deploymentPatch(deployment: DesktopDeployment): string {
  const skills = deployment.officeSkills ?? {}
  const office = {
    ...deployment.welinkinTemplatePath === undefined ? {} : { welinkinTemplatePath: deployment.welinkinTemplatePath },
    ...skills.ppt === undefined ? {} : { pptSkill: skills.ppt },
    ...skills.word === undefined ? {} : { wordSkill: skills.word },
    ...skills.excel === undefined ? {} : { excelSkill: skills.excel },
  }
  const address = {
    controlPlaneUrl: deployment.controlPlaneUrl,
    ...deployment.controlPlaneCa === undefined ? {} : { controlPlaneCa: deployment.controlPlaneCa },
  }
  return `${JSON.stringify([
    {
      id: 'team-account-client',
      config: {
        ...address,
        callbackUri: deployment.callbackUrl,
        runnerVersion: deployment.runnerVersion,
        refreshLeadMs: 60_000,
      },
    },
    {
      id: 'team-local-login',
      config: { applicationPath: '/', maxRequestBodyBytes: 16_384, locale: deployment.locale },
    },
    { id: 'llm-http-transport', config: address },
    { id: 'knowledge', config: address },
    { id: 'web-search-team', config: address },
    ...Object.keys(office).length === 0 ? [] : [{ id: 'office', config: office }],
    // `dsh-web-app` disables the host `skill-filesystem` row because presets own
    // local discovery; a deployment-level skill directory belongs in the host's
    // global skill layer that every preset's catalog merges, so the row is
    // re-enabled for the staged directory alone.
    ...deployment.skillDir === undefined
      ? []
      : [{
        id: 'skill-filesystem',
        disabled: false,
        config: { includeDefaultRoots: false, customSkillDirs: [deployment.skillDir] },
      }],
  ], null, 2)}\n`
}
