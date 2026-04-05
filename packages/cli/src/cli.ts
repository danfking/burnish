#!/usr/bin/env node

/**
 * Burnish CLI — Swagger UI for MCP servers.
 *
 * Usage:
 *   burnish -- npx @modelcontextprotocol/server-filesystem /tmp
 *   burnish --sse https://mcp-server.example.com/sse
 *   burnish --config ./mcp-servers.json
 *   burnish export -- npx @modelcontextprotocol/server-github
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { exportSchema } from './export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')).version;

export interface CliOptions {
    command: 'serve' | 'export';
    serverArgs?: string[];
    sseUrl?: string;
    configPath?: string;
    port: number;
    open: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const args = argv.slice(2); // skip node and script path

    const opts: CliOptions = {
        command: 'serve',
        port: 3000,
        open: true,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === 'export') {
            opts.command = 'export';
            i++;
            continue;
        }

        if (arg === '--') {
            opts.serverArgs = args.slice(i + 1);
            break;
        }

        if (arg === '--sse' && args[i + 1]) {
            opts.sseUrl = args[i + 1];
            i += 2;
            continue;
        }

        if (arg === '--config' && args[i + 1]) {
            opts.configPath = args[i + 1];
            i += 2;
            continue;
        }

        if (arg === '--port' && args[i + 1]) {
            const parsed = parseInt(args[i + 1], 10);
            if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
                console.error(`Invalid port: ${args[i + 1]}`);
                process.exit(1);
            }
            opts.port = parsed;
            i += 2;
            continue;
        }

        if (arg === '--no-open') {
            opts.open = false;
            i++;
            continue;
        }

        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        }

        if (arg === '-v' || arg === '--version') {
            console.log(`burnish ${PKG_VERSION}`);
            process.exit(0);
        }

        // Unknown arg — might be the server command without --
        if (!arg.startsWith('-')) {
            opts.serverArgs = args.slice(i);
            break;
        }

        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }

    return opts;
}

function printHelp() {
    console.log(`
burnish — Swagger UI for MCP servers

Usage:
  burnish [options] -- <command> [args...]    Explore a stdio MCP server
  burnish [options] <command> [args...]       Same, without --
  burnish --sse <url>                         Explore an SSE/HTTP MCP server
  burnish --config <path>                     Use a mcp-servers.json config
  burnish export -- <command> [args...]       Export server schema as JSON

Options:
  --port <n>       Port for the web UI (default: 3000)
  --no-open        Don't auto-open the browser
  --sse <url>      Connect to an SSE/HTTP MCP server
  --config <path>  Path to mcp-servers.json config file
  -h, --help       Show this help
  -v, --version    Show version

Examples:
  burnish -- npx @modelcontextprotocol/server-filesystem /tmp
  burnish -- npx @modelcontextprotocol/server-github
  burnish --sse https://my-mcp.example.com/sse
  burnish export -- npx @modelcontextprotocol/server-github > schema.json
`);
}

async function main() {
    const opts = parseArgs(process.argv);

    if (!opts.serverArgs && !opts.sseUrl && !opts.configPath) {
        console.error('Error: Provide a server command, --sse URL, or --config path.\n');
        printHelp();
        process.exit(1);
    }

    if (opts.command === 'export') {
        await exportSchema(opts);
        process.exit(0);
    }

    await startServer(opts);
}

main().catch((err) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
});
