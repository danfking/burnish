/**
 * MCP Client Hub — connects to multiple MCP servers and discovers their tools.
 * Uses @modelcontextprotocol/sdk for stdio and SSE transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

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

export class McpHub {
    private servers: ConnectedServer[] = [];
    private configFilePath: string | undefined;

    /**
     * Load MCP server config and connect to all servers.
     */
    async initialize(configPath: string): Promise<void> {
        this.configFilePath = configPath;

        let config: McpServersConfig;
        try {
            await access(configPath, constants.R_OK);
            const raw = await readFile(configPath, 'utf-8');
            config = JSON.parse(raw);
        } catch {
            console.warn('[mcp-hub] No config file found at', configPath);
            return;
        }

        await Promise.allSettled(
            Object.entries(config.mcpServers).map(async ([name, serverConfig]) => {
                try {
                    await this.connectServer(name, serverConfig);
                    console.log(`[mcp-hub] Connected to "${name}"`);
                } catch (err) {
                    console.error(`[mcp-hub] Failed to connect to "${name}":`, err);
                }
            }),
        );
    }

    private async connectServer(
        name: string,
        config: McpServerConfig,
    ): Promise<void> {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...process.env, ...config.env } as Record<string, string>,
            cwd: this.configFilePath ? resolve(this.configFilePath, '..') : undefined,
        });

        const client = new Client({ name: `burnish-${name}`, version: '0.1.0' });
        await client.connect(transport);

        // Discover tools
        const toolsResult = await client.listTools();
        const tools: ToolDef[] = (toolsResult.tools || []).map((t: any) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
            serverName: name,
        }));

        this.servers.push({ name, client, transport, tools, config });
    }

    /**
     * Get all available tools across all connected servers.
     */
    getAllTools(): ToolDef[] {
        return this.servers.flatMap(s => s.tools);
    }

    /**
     * Get connected server info.
     */
    getServerInfo(): Array<{ name: string; toolCount: number; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }> {
        return this.servers.map(s => ({
            name: s.name,
            toolCount: s.tools.length,
            tools: s.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        }));
    }

    /**
     * Execute a tool call by name. Routes to the correct MCP server.
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<string> {
        for (const server of this.servers) {
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
    async shutdown(): Promise<void> {
        for (const server of this.servers) {
            try {
                await server.client.close();
            } catch { /* ignore cleanup errors */ }
        }
        this.servers.length = 0;
    }
}
