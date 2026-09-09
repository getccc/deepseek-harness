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
  return {
    controlPlaneUrl: controlPlane.origin,
    ...input.controlPlaneCa === undefined ? {} : { controlPlaneCa: input.controlPlaneCa },
    runnerVersion: input.runnerVersion,
    callbackUrl: callback.href,
    locale: input.locale,
    ...input.welinkinTemplatePath === undefined ? {} : { welinkinTemplatePath: input.welinkinTemplatePath },
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
    ...deployment.welinkinTemplatePath === undefined
      ? []
      : [{ id: 'office', config: { welinkinTemplatePath: deployment.welinkinTemplatePath } }],
  ], null, 2)}\n`
}
