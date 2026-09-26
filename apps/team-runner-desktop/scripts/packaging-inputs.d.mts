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

/** Environment variable carrying the release public key this build trusts. */
export declare const RELEASE_KEY_ENV: 'DSH_TEAM_RELEASE_KEY'

/**
 * Validate the release public key: base64url DER SPKI of an Ed25519 key.
 * @param env - the packaging environment.
 * @returns the validated key, or undefined when this build carries none.
 * @throws when the variable holds something that is not such a key.
 */
export declare function resolveReleaseKey(env: NodeJS.ProcessEnv): string | undefined

/** Environment variable naming where this build fetches release artifacts. */
export declare const UPDATE_ORIGIN_ENV: 'DSH_TEAM_UPDATE_ORIGIN'

/**
 * Where the installed build fetches release artifacts.
 * @param env - the packaging environment.
 * @param controlPlaneUrl - the deployment's Control Plane origin.
 * @returns the directory releases are served from, ending in a slash.
 * @throws when the variable names something other than an http(s) address.
 */
export declare function resolveUpdateOrigin(env: NodeJS.ProcessEnv, controlPlaneUrl: string): string
