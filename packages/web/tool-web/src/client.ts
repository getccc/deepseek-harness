/**
 * Client-namespace projection of the web switch types: a pure re-export of
 * the package's types outlet, so client code imports only the client
 * namespace and still sees the `web/access` event and `webAccess` projection
 * declarations.
 * @module @deepseek-ai/dsh-tool-web/client
 */

export type * from './types.ts'
