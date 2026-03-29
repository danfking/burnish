/**
 * MCP Client Hub — connects to multiple MCP servers and discovers their tools.
 * Uses @modelcontextprotocol/sdk for stdio and SSE transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';

export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface McpServersConfig {
    mcpServers: Record<string, McpServerConfig>;
}

export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
}

interface ConnectedServer {
    name: string;
    client: Client;
    transport: StdioClientTransport;
    tools: ToolDef[];
    config: McpServerConfig;
}

const servers: ConnectedServer[] = [];
let configFilePath: string | undefined;

/**
 * Load MCP server config and connect to all servers.
 */
export async function initialize(configPath: string): Promise<void> {
    configFilePath = configPath;
    const raw = await readFile(configPath, 'utf-8');
    const config: McpServersConfig = JSON.parse(raw);

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        try {
            await connectServer(name, serverConfig);
            console.log(`[mcp-hub] Connected to "${name}"`);
        } catch (err) {
            console.error(`[mcp-hub] Failed to connect to "${name}":`, err);
        }
    }
}

async function connectServer(
    name: string,
    config: McpServerConfig,
): Promise<void> {
    const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client({ name: `mcpui-${name}`, version: '0.1.0' });
    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: ToolDef[] = (toolsResult.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        serverName: name,
    }));

    servers.push({ name, client, transport, tools, config });
}

/**
 * Add a new MCP server at runtime, connect to it, and persist config.
 */
export async function addServer(
    name: string,
    config: McpServerConfig,
): Promise<void> {
    // Disconnect existing server with same name if present
    const idx = servers.findIndex(s => s.name === name);
    if (idx !== -1) {
        try { await servers[idx].client.close(); } catch { /* ignore */ }
        servers.splice(idx, 1);
    }
    await connectServer(name, config);
    console.log(`[mcp-hub] Connected to "${name}"`);
    await persistConfig();
}

/**
 * Remove an MCP server by name, disconnect, and persist config.
 */
export async function removeServer(name: string): Promise<void> {
    const idx = servers.findIndex(s => s.name === name);
    if (idx === -1) {
        throw new Error(`Server "${name}" not found`);
    }
    try { await servers[idx].client.close(); } catch { /* ignore */ }
    servers.splice(idx, 1);
    await persistConfig();
}

/**
 * Write current server configs back to the config file.
 */
async function persistConfig(): Promise<void> {
    if (!configFilePath) return;
    const mcpServers: Record<string, McpServerConfig> = {};
    for (const s of servers) {
        mcpServers[s.name] = s.config;
    }
    const data: McpServersConfig = { mcpServers };
    await writeFile(configFilePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Get all available tools across all connected servers.
 */
export function getAllTools(): ToolDef[] {
    return servers.flatMap(s => s.tools);
}

/**
 * Get connected server info.
 */
export function getServerInfo(): Array<{ name: string; toolCount: number; tools: string[] }> {
    return servers.map(s => ({
        name: s.name,
        toolCount: s.tools.length,
        tools: s.tools.map(t => t.name),
    }));
}

/**
 * Execute a tool call by name. Routes to the correct MCP server.
 */
export async function executeTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { skipGuard?: boolean },
): Promise<string> {
    // Layer 1: Pre-execution guard — blocks write tools unless authorized
    if (!options?.skipGuard) {
        const { guardToolExecution } = await import('./guards.js');
        const guard = guardToolExecution(toolName, args);
        if (!guard.allowed) {
            console.warn(`[mcp-hub] Guard blocked: ${guard.reason}`);
            return JSON.stringify({ blocked: true, reason: guard.reason });
        }
    }

    for (const server of servers) {
        const tool = server.tools.find(t => t.name === toolName);
        if (tool) {
            const result = await server.client.callTool({
                name: toolName,
                arguments: args,
            });

            // Extract text content from result
            if (result.content && Array.isArray(result.content)) {
                return result.content
                    .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                    .join('\n');
            }
            return JSON.stringify(result);
        }
    }
    throw new Error(`Tool "${toolName}" not found on any connected server`);
}

/**
 * Gracefully disconnect all servers.
 */
export async function shutdown(): Promise<void> {
    for (const server of servers) {
        try {
            await server.client.close();
        } catch { /* ignore cleanup errors */ }
    }
    servers.length = 0;
}
