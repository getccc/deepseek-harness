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

/** Environment variable naming the CPU architecture of a macOS build. */
export declare const MAC_ARCHITECTURE_ENV: 'DSH_TEAM_MAC_ARCH'

/**
 * Decide which CPU architecture the macOS build is for.
 * @param env - the packaging environment.
 * @param runner - the Runner executable path.
 * @returns the environment's architecture, else the one the executable's `-macos-<arch>` name states, else `arm64`.
 * @throws when the variable is neither `arm64` nor `x64`, or disagrees with the executable's name.
 */
export declare function resolveMacArchitecture(env: NodeJS.ProcessEnv, runner: string): 'arm64' | 'x64'

/** Environment variable naming the prepared Office sidecar directory this build carries. */
export declare const OFFICE_SIDECAR_ENV: 'DSH_TEAM_OFFICE_SIDECAR'

/**
 * Validate the Office sidecar directory the Runner converts Office documents with.
 * @param env - the packaging environment.
 * @param windows - whether the Runner executable is a Windows build.
 * @param macArchitecture - the macOS architecture; ignored for Windows, which is x64 only.
 * @returns the validated sidecar directory.
 * @throws when the variable is absent or the directory lacks the Node runtime or this platform's LibreOffice packages.
 */
export declare function resolveOfficeSidecar(env: NodeJS.ProcessEnv, windows: boolean, macArchitecture: 'arm64' | 'x64'): string
