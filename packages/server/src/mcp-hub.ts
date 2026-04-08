/**
 * MCP Client Hub — connects to multiple MCP servers and discovers their tools.
 * Uses @modelcontextprotocol/sdk for stdio and SSE transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export interface McpServerConfig {
    command?: string;       // stdio transport (local subprocess)
    args?: string[];
    env?: Record<string, string>;
    url?: string;           // streamable HTTP transport (remote server)
    headers?: Record<string, string>;  // optional auth headers for HTTP
}

export interface CliToolConfig {
    command: string;
    args?: string[];
    description: string;
    timeout?: number; // default 5000ms
}

export interface McpServersConfig {
    mcpServers: Record<string, McpServerConfig>;
    cliTools?: Record<string, CliToolConfig>;
}

export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
}

export interface ToolResult {
    content: string;
    isError: boolean;
}

interface CliTool {
    name: string;
    config: CliToolConfig;
    toolDef: ToolDef;
}

interface ConnectedServer {
    name: string;
    client: Client;
    transport: Transport;
    tools: ToolDef[];
    config: McpServerConfig;
    status: 'connected' | 'disconnected';
    lastError?: string;
    lastErrorTime?: number;
}

export class McpHub {
    private servers: ConnectedServer[] = [];
    private cliTools: CliTool[] = [];
    private configFilePath: string | undefined;

    /**
     * Load MCP server config and connect to all servers.
     */
    async initialize(configPath: string): Promise<void> {
        this.configFilePath = configPath;

        let config: McpServersConfig;
        try {
            await access(configPath, constants.R_OK);
        } catch {
            throw new Error(`Config file not found: ${configPath}`);
        }

        try {
            const raw = await readFile(configPath, 'utf-8');
            config = JSON.parse(raw);
        } catch (err) {
            throw new Error(
                `Failed to read config file at ${configPath}: ${err instanceof Error ? err.message : err}`,
            );
        }

        await Promise.allSettled(
            Object.entries(config.mcpServers).map(async ([name, serverConfig]) => {
                try {
                    await this.connectServer(name, serverConfig);
                    console.error(`[mcp-hub] Connected to "${name}"`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`[mcp-hub] Failed to connect to "${name}":`, message);
                    this.servers.push({
                        name,
                        client: null as any,
                        transport: null as any,
                        tools: [],
                        config: serverConfig,
                        status: 'disconnected',
                        lastError: message,
                        lastErrorTime: Date.now(),
                    });
                }
            }),
        );

        if (config.cliTools && Object.keys(config.cliTools).length > 0) {
            this.registerCliTools(config.cliTools);
        }
    }

    /**
     * Register a pre-connected MCP client with the hub.
     *
     * This allows callers to connect a Client via any transport (e.g.
     * InMemoryTransport) and hand it to the hub for tool discovery
     * and execution.
     */
    async registerClient(
        name: string,
        client: Client,
        transport: Transport,
    ): Promise<void> {
        const toolsResult = await client.listTools();
        const tools: ToolDef[] = (toolsResult.tools || []).map((t: any) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
            serverName: name,
        }));

        this.servers.push({
            name,
            client,
            transport,
            tools,
            config: {},
            status: 'connected',
        });
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

        console.error(`[mcp-hub] Attempting to reconnect "${name}"...`);
        try {
            try { await server.client.close(); } catch { /* ignore */ }

            // Re-connect using the saved config (connectServer pushes a new entry)
            await this.connectServer(name, server.config);

            // Remove the old entry (connectServer already appended a fresh one)
            this.servers.splice(idx, 1);

            console.error(`[mcp-hub] Reconnected to "${name}"`);
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
        const mcpTools = this.servers.flatMap(s => s.tools);
        const cliToolDefs = this.cliTools.map(ct => ct.toolDef);
        return [...mcpTools, ...cliToolDefs];
    }

    /**
     * Get connected server info.
     */
    getServerInfo(): Array<{ name: string; toolCount: number; status: string; lastError?: string; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }> {
        const serverInfo = this.servers.map(s => ({
            name: s.name,
            toolCount: s.tools.length,
            status: s.status,
            lastError: s.lastError,
            tools: s.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        }));

        if (this.cliTools.length > 0) {
            serverInfo.push({
                name: 'cli',
                toolCount: this.cliTools.length,
                status: 'connected' as const,
                lastError: undefined,
                tools: this.cliTools.map(ct => ({
                    name: ct.toolDef.name,
                    description: ct.toolDef.description,
                    inputSchema: ct.toolDef.inputSchema,
                })),
            });
        }

        return serverInfo;
    }

    /**
     * Execute a tool call by name. Routes to the correct MCP server.
     */
    private extractToolResult(result: any): ToolResult {
        const isError = result.isError === true;
        if (result.content && Array.isArray(result.content)) {
            const content = result.content
                .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                .join('\n');
            return { content, isError };
        }
        return { content: JSON.stringify(result), isError };
    }

    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<ToolResult> {
        for (const server of this.servers) {
            const tool = server.tools.find(t => t.name === toolName);
            if (tool) {
                try {
                    const result = await server.client.callTool({
                        name: toolName,
                        arguments: args,
                    });

                    server.status = 'connected'; // Mark healthy on success

                    return this.extractToolResult(result);
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
                            return this.extractToolResult(retryResult);
                        }
                    }
                    throw err; // Reconnect failed or retry server not found
                }
            }
        }
        // Check CLI tools
        const cliTool = this.cliTools.find(ct => ct.name === toolName);
        if (cliTool) {
            const content = await this.executeCliTool(cliTool);
            return { content, isError: false };
        }

        throw new Error(`Tool "${toolName}" not found on any connected server`);
    }

    private registerCliTools(configs: Record<string, CliToolConfig>): void {
        for (const [name, config] of Object.entries(configs)) {
            const toolDef: ToolDef = {
                name,
                description: config.description,
                inputSchema: { type: 'object', properties: {} },
                serverName: 'cli',
            };
            this.cliTools.push({ name, config, toolDef });
            console.error(`[mcp-hub] Registered CLI tool "${name}"`);
        }
    }

    private executeCliTool(cliTool: CliTool): Promise<string> {
        return new Promise((resolvePromise, reject) => {
            const timeout = cliTool.config.timeout || 5000;
            const cwd = this.configFilePath ? resolve(this.configFilePath, '..') : undefined;
            // No shell: true — args are passed as argv array to prevent command injection.
            // If shell features are needed, use command: "bash" with args: ["-c", "..."].
            const proc = spawn(cliTool.config.command, cliTool.config.args || [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd,
            });

            let stdout = '';
            let stderr = '';

            const timer = setTimeout(() => {
                proc.kill();
                reject(new Error(`CLI tool "${cliTool.name}" timed out after ${timeout}ms`));
            }, timeout);

            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolvePromise(stdout.trim() || '(no output)');
                } else {
                    reject(new Error(`CLI tool "${cliTool.name}" exited with code ${code}: ${stderr || stdout}`));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`CLI tool "${cliTool.name}" failed to start: ${err.message}`));
            });
        });
    }

    /**
     * Gracefully disconnect all servers.
     */
    async shutdown(): Promise<void> {
        for (const server of this.servers) {
            try {
                if (server.client) await server.client.close();
            } catch { /* ignore cleanup errors */ }
        }
        this.servers.length = 0;
        this.cliTools.length = 0;
    }
}
