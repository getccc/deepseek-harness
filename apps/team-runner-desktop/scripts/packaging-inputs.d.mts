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
