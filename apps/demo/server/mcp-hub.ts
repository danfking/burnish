/**
 * MCP Client Hub — connects to multiple MCP servers and discovers their tools.
 * Uses @modelcontextprotocol/sdk for stdio and SSE transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';

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
}

const servers: ConnectedServer[] = [];

/**
 * Load MCP server config and connect to all servers.
 */
export async function initialize(configPath: string): Promise<void> {
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

    servers.push({ name, client, transport, tools });
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
): Promise<string> {
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
