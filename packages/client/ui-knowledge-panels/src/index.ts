/**
 * Knowledge panels plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader; the browser half
 * ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. Everything the panels read comes from the
 * `knowledge` Remote namespace that `@deepseek-ai/dsh-api-knowledge-controller`
 * serves and `@deepseek-ai/dsh-client-ui-knowledge` mounts.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
