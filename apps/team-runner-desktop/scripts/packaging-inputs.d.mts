/** Environment variable naming the release this build is. */
export declare const APP_VERSION_ENV: 'DSH_TEAM_APP_VERSION'

/**
 * Validate the release version this build carries.
 * @param env - the packaging environment.
 * @returns the validated `MAJOR.MINOR.PATCH` version.
 * @throws when the variable is absent or carries a suffix.
 */
export declare function resolveAppVersion(env: NodeJS.ProcessEnv): string

/**
 * Identify the plugin tree by its content.
 * @param directory - the staged plugin tree.
 * @returns a stable short digest of the tree's contents.
 */
export declare function pluginTreeFingerprint(directory: string): string
