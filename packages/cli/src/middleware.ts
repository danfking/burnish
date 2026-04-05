/**
 * withBurnishUI() — one-line middleware to serve the Burnish Explorer UI
 * alongside an MCP SDK server running in the same process.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { withBurnishUI } from "burnish/middleware";
 *
 * const server = new McpServer({ name: "my-server", version: "1.0.0" });
 * server.tool("ping", {}, async () => ({ content: [{ type: "text", text: "pong" }] }));
 *
 * await withBurnishUI(server, { port: 3001 });
 * ```
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { McpHub } from '@burnish/server';
import { startServerWithHub, type ServerOptions } from './server.js';

/**
 * Options for `withBurnishUI()`.
 */
export interface BurnishUIOptions extends ServerOptions {
    /**
     * Display name for the server in the Explorer UI.
     * Defaults to the server's declared name.
     */
    name?: string;
}

/**
 * Resolve the low-level `Server` instance from either an `McpServer`
 * (high-level wrapper) or a raw `Server`.
 */
function resolveServer(input: McpServer | Server): Server {
    // McpServer has a `.server` property that holds the low-level Server
    if ('server' in input && typeof (input as any).server?.connect === 'function') {
        return (input as McpServer).server;
    }
    // Already a low-level Server
    return input as Server;
}

/**
 * Start the Burnish Explorer UI connected to an in-process MCP SDK server.
 *
 * Accepts either a high-level `McpServer` or a low-level `Server` instance
 * from `@modelcontextprotocol/sdk`.
 *
 * @param mcpServer  An MCP SDK Server (or McpServer) instance with tools registered
 * @param opts       Server options (port, open browser, display name)
 */
export async function withBurnishUI(
    mcpServer: McpServer | Server,
    opts?: BurnishUIOptions,
): Promise<void> {
    const server = resolveServer(mcpServer);

    // Create an in-memory transport pair: one side for the server, one for the client
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect the MCP server to its side of the transport
    await server.connect(serverTransport);

    // Create a Burnish client and connect it to the other side
    const client = new Client({ name: 'burnish-explorer', version: '0.1.0' });
    await client.connect(clientTransport);

    // Build an McpHub and register the connected client
    const hub = new McpHub();
    const serverName = opts?.name ?? (server as any).serverInfo?.name ?? 'mcp-server';
    await hub.registerClient(serverName, client, clientTransport);

    const serverInfo = hub.getServerInfo();
    const totalTools = serverInfo.reduce((sum, s) => sum + s.toolCount, 0);
    console.log(`[burnish] Connected in-process: ${totalTools} tools from "${serverName}"`);

    // Start the HTTP server with the Burnish UI
    await startServerWithHub(hub, {
        port: opts?.port,
        open: opts?.open,
    });
}
