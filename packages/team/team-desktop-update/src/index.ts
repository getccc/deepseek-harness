/**
 * Desktop update control, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Checking, downloading, and installing a release belong to the
 * desktop shell, which the browser half reaches through a window bridge.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
