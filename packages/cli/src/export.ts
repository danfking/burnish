/**
 * Export MCP server schema as JSON to stdout.
 */

import { McpHub } from '@burnish/server';
import { buildConfigFile, cleanupTempConfig } from './config.js';
import type { CliOptions } from './cli.js';

const CONNECT_TIMEOUT_MS = 30_000;

export async function exportSchema(opts: CliOptions): Promise<void> {
    const configPath = await buildConfigFile(opts);

    const mcpHub = new McpHub();

    console.error('[burnish] Connecting to MCP server...');

    try {
        await Promise.race([
            mcpHub.initialize(configPath),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Connection timed out after 30s')), CONNECT_TIMEOUT_MS),
            ),
        ]);
    } catch (err) {
        console.error('[burnish] Failed to connect:', err instanceof Error ? err.message : err);
        await cleanupTempConfig();
        process.exit(1);
    }

    const serverInfo = mcpHub.getServerInfo();
    const allTools = mcpHub.getAllTools();

    const schema = {
        burnish: '1.0',
        exportedAt: new Date().toISOString(),
        servers: serverInfo.map((s) => ({
            name: s.name,
            status: s.status,
            toolCount: s.toolCount,
        })),
        tools: allTools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            serverName: t.serverName,
        })),
    };

    // Output to stdout (status messages go to stderr)
    console.log(JSON.stringify(schema, null, 2));

    await mcpHub.shutdown();
    await cleanupTempConfig();
}
