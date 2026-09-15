/**
 * Web access control plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The switch itself (the `/web` command, the
 * `webAccess` projection, and the per-session tool restriction) is owned by
 * `@deepseek-ai/dsh-tool-web`, composed inside the agent presets that offer it.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
