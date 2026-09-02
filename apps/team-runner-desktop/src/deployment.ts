/** Deployment facts baked into one enterprise desktop build. */
export interface DesktopDeployment {
  readonly controlPlaneUrl: string
  readonly runnerVersion: string
  readonly callbackUrl: string
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
  return {
    controlPlaneUrl: controlPlane.origin,
    runnerVersion: input.runnerVersion,
    callbackUrl: callback.href,
  }
}

/**
 * Render the deployment-owned profile patch consumed by the bundled `dsh`
 * executable. JSON is valid YAML and avoids quoting deployment-controlled text.
 * @param deployment - validated enterprise build facts.
 * @returns a Team profile patch document.
 */
export function deploymentPatch(deployment: DesktopDeployment): string {
  return `${JSON.stringify([
    {
      id: 'team-account-client',
      config: {
        controlPlaneUrl: deployment.controlPlaneUrl,
        callbackUri: deployment.callbackUrl,
        runnerVersion: deployment.runnerVersion,
        refreshLeadMs: 60_000,
      },
    },
    {
      id: 'llm-http-transport',
      config: { controlPlaneUrl: deployment.controlPlaneUrl },
    },
    {
      id: 'knowledge',
      config: { controlPlaneUrl: deployment.controlPlaneUrl },
    },
  ], null, 2)}\n`
}
