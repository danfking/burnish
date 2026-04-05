/**
 * Burnish CLI — programmatic API.
 *
 * @example
 * ```ts
 * import { McpHub } from '@burnish/server';
 * import { startServerWithHub, buildApp } from 'burnish';
 *
 * const hub = new McpHub();
 * await hub.initialize('./mcp-servers.json');
 * await startServerWithHub(hub, { port: 4000 });
 * ```
 */

export { startServerWithHub, buildApp } from './server.js';
export type { ServerOptions } from './server.js';

export { withBurnishUI } from './middleware.js';
export type { BurnishUIOptions } from './middleware.js';
