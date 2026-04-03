/**
 * MCP Client Hub — connects to multiple MCP servers and discovers their tools.
 * Uses @modelcontextprotocol/sdk for stdio and SSE transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

export interface McpServerConfig {
    command?: string;       // stdio transport (local subprocess)
    args?: string[];
    env?: Record<string, string>;
    url?: string;           // streamable HTTP transport (remote server)
    headers?: Record<string, string>;  // optional auth headers for HTTP
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
    transport: StdioClientTransport | StreamableHTTPClientTransport;
    tools: ToolDef[];
    config: McpServerConfig;
    status: 'connected' | 'disconnected';
    lastError?: string;
    lastErrorTime?: number;
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
        let transport: StdioClientTransport | StreamableHTTPClientTransport;
        if (config.url) {
            // Streamable HTTP transport for remote servers
            // TRUST: headers come from the local mcp-servers.json config file,
            // not from user input. If config is ever sourced from untrusted input,
            // headers must be validated to prevent SSRF.
            const opts: { requestInit?: RequestInit } = {};
            if (config.headers) {
                opts.requestInit = { headers: config.headers };
            }
            transport = new StreamableHTTPClientTransport(
                new URL(config.url),
                opts,
            );
        } else if (config.command) {
            // Stdio transport for local servers
            transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: { ...process.env, ...config.env } as Record<string, string>,
                cwd: this.configFilePath ? resolve(this.configFilePath, '..') : undefined,
            });
        } else {
            throw new Error(`Server "${name}" must have either "command" (stdio) or "url" (HTTP) in config`);
        }

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

        this.servers.push({ name, client, transport, tools, config, status: 'connected' });
    }

    /**
     * Check if a named server is healthy by issuing a listTools ping.
     */
    async checkHealth(name: string): Promise<boolean> {
        const server = this.servers.find(s => s.name === name);
        if (!server) return false;
        try {
            await server.client.listTools();
            server.status = 'connected';
            server.lastError = undefined;
            return true;
        } catch (err) {
            server.status = 'disconnected';
            server.lastError = err instanceof Error ? err.message : String(err);
            server.lastErrorTime = Date.now();
            return false;
        }
    }

    /**
     * Attempt to reconnect a disconnected server using its saved config.
     */
    private async reconnectServer(name: string): Promise<boolean> {
        const idx = this.servers.findIndex(s => s.name === name);
        if (idx === -1) return false;
        const server = this.servers[idx];

        console.log(`[mcp-hub] Attempting to reconnect "${name}"...`);
        try {
            try { await server.client.close(); } catch { /* ignore */ }

            // Re-connect using the saved config (connectServer pushes a new entry)
            await this.connectServer(name, server.config);

            // Remove the old entry (connectServer already appended a fresh one)
            this.servers.splice(idx, 1);

            console.log(`[mcp-hub] Reconnected to "${name}"`);
            return true;
        } catch (err) {
            console.error(`[mcp-hub] Failed to reconnect to "${name}":`, err);
            server.status = 'disconnected';
            server.lastError = err instanceof Error ? err.message : String(err);
            server.lastErrorTime = Date.now();
            return false;
        }
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
    getServerInfo(): Array<{ name: string; toolCount: number; status: string; lastError?: string; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }> {
        return this.servers.map(s => ({
            name: s.name,
            toolCount: s.tools.length,
            status: s.status,
            lastError: s.lastError,
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
                try {
                    const result = await server.client.callTool({
                        name: toolName,
                        arguments: args,
                    });

                    server.status = 'connected'; // Mark healthy on success

                    // Extract text content from result
                    if (result.content && Array.isArray(result.content)) {
                        return result.content
                            .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                            .join('\n');
                    }
                    return JSON.stringify(result);
                } catch (err) {
                    // Mark disconnected and attempt reconnect
                    server.status = 'disconnected';
                    server.lastError = err instanceof Error ? err.message : String(err);
                    server.lastErrorTime = Date.now();
                    console.warn(`[mcp-hub] Tool call failed on "${server.name}", attempting reconnect...`);

                    const reconnected = await this.reconnectServer(server.name);
                    if (reconnected) {
                        // Retry the tool call once after reconnect
                        const retryServer = this.servers.find(s => s.name === server.name);
                        if (retryServer) {
                            const retryResult = await retryServer.client.callTool({
                                name: toolName,
                                arguments: args,
                            });
                            // Extract text content from retry result
                            if (retryResult.content && Array.isArray(retryResult.content)) {
                                return retryResult.content
                                    .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                                    .join('\n');
                            }
                            return JSON.stringify(retryResult);
                        }
                    }
                    throw err; // Reconnect failed or retry server not found
                }
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
