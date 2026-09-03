/**
 * The Team profile this desktop build composes in its private Harness home.
 *
 * The bundled Runner executable carries the in-box bundles, and the installer
 * ships the out-of-tree plugins as a real directory tree beside it, because
 * their native addons and their own dependency copying cannot read a packaged
 * executable's virtual filesystem. The shell therefore owns the profile
 * manifest instead of letting `dsh` initialize the shipped template: a member
 * never installs plugins into this profile, and an application upgrade that
 * changes the layer list must take effect on the next launch.
 * @module
 */

/** Bundle layers the Runner executable resolves from its own installation. */
export const RUNNER_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-team',
] as const

/** Bundle layers the installer ships as a plugin tree, in mount order. */
export const SHIPPED_PLUGIN_BUNDLES = ['dsh-univer-office', 'dsh-better-sidebar', '@dsh-external/dsh-echarts'] as const

/**
 * Render the deployment-owned profile manifest.
 * @param shippedPlugins - whether the installer carried the plugin tree.
 * @returns a `package.json` document for the private Team profile directory.
 */
export function profileManifest(shippedPlugins: boolean): string {
  return `${JSON.stringify({
    name: 'dsh-profile-team',
    private: true,
    // No pnpm-managed dependency: the shipped plugin tree is linked in, and
    // this profile never runs a package manager.
    dependencies: {},
    dsh: {
      profile: {
        bundles: [...RUNNER_BUNDLES, ...shippedPlugins ? SHIPPED_PLUGIN_BUNDLES : []],
        // The member's own patch file stays live-reloadable, matching the
        // shipped `team` template; the deployment patch is a launcher layer.
        patchReload: 'live',
      },
    },
  }, null, 2)}\n`
}
