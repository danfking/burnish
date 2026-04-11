#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "burnish-example-server",
  version: "0.1.0",
});

// --- Tool: get-project-info ---
server.tool(
  "get-project-info",
  "Returns structured project metadata suitable for rendering as a status card",
  {},
  async () => {
    const info = {
      name: "Burnish",
      version: "0.1.0",
      description:
        "Universal UI layer for MCP servers — explore, test, and visualize any MCP server with rich components",
      status: "Active",
      lastUpdated: "2026-04-05",
      contributors: 12,
      openIssues: 8,
      stars: 342,
      license: "AGPL-3.0",
      language: "TypeScript",
      repository: "https://github.com/danfking/burnish",
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
    };
  }
);

// --- Tool: list-users ---
server.tool(
  "list-users",
  "Returns a list of users with their roles and status, suitable for rendering as a data table",
  {},
  async () => {
    const users = [
      {
        id: 1,
        name: "Alice Chen",
        email: "alice@example.com",
        role: "Admin",
        status: "Active",
        joined: "2025-01-15",
      },
      {
        id: 2,
        name: "Bob Martinez",
        email: "bob@example.com",
        role: "Developer",
        status: "Active",
        joined: "2025-02-20",
      },
      {
        id: 3,
        name: "Carol Williams",
        email: "carol@example.com",
        role: "Designer",
        status: "Active",
        joined: "2025-03-10",
      },
      {
        id: 4,
        name: "David Kim",
        email: "david@example.com",
        role: "Developer",
        status: "Inactive",
        joined: "2025-04-05",
      },
      {
        id: 5,
        name: "Eva Singh",
        email: "eva@example.com",
        role: "PM",
        status: "Active",
        joined: "2025-05-12",
      },
      {
        id: 6,
        name: "Frank Osei",
        email: "frank@example.com",
        role: "Developer",
        status: "Active",
        joined: "2025-06-01",
      },
      {
        id: 7,
        name: "Grace Tanaka",
        email: "grace@example.com",
        role: "QA",
        status: "On Leave",
        joined: "2025-07-18",
      },
      {
        id: 8,
        name: "Henry Novak",
        email: "henry@example.com",
        role: "DevOps",
        status: "Active",
        joined: "2025-08-22",
      },
    ];

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(users, null, 2) },
      ],
    };
  }
);

// --- Tool: get-system-stats ---
server.tool(
  "get-system-stats",
  "Returns current system metrics including CPU, memory, disk usage, and connection stats",
  {},
  async () => {
    const stats = {
      cpuUsage: "42.5%",
      cpuCores: 8,
      cpuModel: "Intel Xeon E5-2686 v4",
      memoryUsed: "12.3 GB / 32 GB (38.4%)",
      diskUsed: "156 GB / 500 GB (31.2%)",
      activeConnections: 247,
      requestsPerSecond: 1842,
      bandwidthMbps: 450,
      uptime: "45d 12h 33m",
      healthyServices: 18,
      degradedServices: 2,
      downServices: 0,
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats, null, 2) },
      ],
    };
  }
);

// --- Tool: get-sales-data ---
server.tool(
  "get-sales-data",
  "Returns monthly sales data with categories, amounts, and trends for chart visualization",
  {},
  async () => {
    const summary = [
      { label: "Total Revenue", value: "$1,466,000" },
      { label: "Growth Rate", value: "97.6%" },
      { label: "Top Category", value: "Software" },
      { label: "Avg Monthly", value: "$122,167" },
    ];

    const chart = {
      title: "Monthly Revenue — 2025",
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      datasets: [
        {
          label: "Revenue ($k)",
          data: [85, 92, 99, 105, 111, 121, 128, 131, 128, 150, 148, 168],
        },
      ],
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        { type: "text" as const, text: JSON.stringify(chart, null, 2) },
      ],
    };
  }
);

// --- Tool: get-deployment-pipeline ---
server.tool(
  "get-deployment-pipeline",
  "Returns deployment pipeline stages with status indicators for each stage",
  {},
  async () => {
    const pipeline = {
      _ui_hint: "pipeline",
      steps: [
        { server: "ci", tool: "build", status: "success", duration: "2m 14s" },
        { server: "ci", tool: "unit-tests", status: "success", duration: "1m 48s" },
        { server: "ci", tool: "integration-tests", status: "success", duration: "4m 32s" },
        { server: "security", tool: "dependency-scan", status: "running", duration: "1m 05s" },
        { server: "deploy", tool: "staging", status: "pending" },
        { server: "deploy", tool: "production", status: "pending" },
      ],
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(pipeline, null, 2) }],
    };
  }
);

// --- Tool: get-server-metrics ---
server.tool(
  "get-server-metrics",
  "Returns live server performance metrics with trend indicators",
  {},
  async () => {
    const metrics = [
      { label: "Uptime", value: "99.97", unit: "%", trend: "flat" },
      { label: "Avg Response", value: "42", unit: "ms", trend: "down" },
      { label: "Active Users", value: "1,847", trend: "up" },
      { label: "Error Rate", value: "0.03", unit: "%", trend: "down" },
    ];
    return {
      content: metrics.map(m => ({ type: "text" as const, text: JSON.stringify(m) })),
    };
  }
);

// --- Tool: list-api-endpoints ---
server.tool(
  "list-api-endpoints",
  "Returns API endpoint documentation with methods, paths, and descriptions",
  {},
  async () => {
    const endpoints = [
      { method: "GET", path: "/api/servers", status: "stable", auth: "optional", description: "List connected MCP servers" },
      { method: "POST", path: "/api/tools/execute", status: "stable", auth: "required", description: "Execute a tool directly" },
      { method: "GET", path: "/api/health", status: "stable", auth: "none", description: "Health check endpoint" },
      { method: "POST", path: "/api/chat", status: "stable", auth: "required", description: "Create a new conversation" },
      { method: "GET", path: "/api/chat/:id/stream", status: "stable", auth: "required", description: "Stream conversation responses via SSE" },
      { method: "GET", path: "/api/models", status: "stable", auth: "optional", description: "List available LLM models" },
      { method: "GET", path: "/api/prompts", status: "beta", auth: "optional", description: "List MCP prompt templates" },
      { method: "POST", path: "/api/prompts/execute", status: "beta", auth: "required", description: "Execute a prompt template" },
      { method: "GET", path: "/api/resources", status: "beta", auth: "optional", description: "List MCP resources" },
      { method: "GET", path: "/api/resources/:uri", status: "beta", auth: "required", description: "Read a specific resource" },
      { method: "POST", path: "/api/tools/batch", status: "experimental", auth: "required", description: "Execute multiple tools in sequence" },
      { method: "GET", path: "/api/sessions", status: "stable", auth: "required", description: "List active sessions" },
      { method: "DELETE", path: "/api/sessions/:id", status: "stable", auth: "required", description: "Delete a session" },
      { method: "GET", path: "/api/schema/:tool", status: "stable", auth: "none", description: "Get JSON schema for a tool" },
      { method: "POST", path: "/api/webhooks", status: "experimental", auth: "required", description: "Register a webhook for tool events" },
    ];
    return { content: [{ type: "text" as const, text: JSON.stringify(endpoints) }] };
  }
);

// --- Tool: create-bug-report ---
server.tool(
  "create-bug-report",
  "Submit a bug report with details for tracking",
  {
    title: z.string().describe("Bug title"),
    severity: z.enum(["low", "medium", "high", "critical"]).describe("Severity level"),
    description: z.string().describe("Detailed description of the bug"),
    steps_to_reproduce: z.string().optional().describe("Steps to reproduce the issue"),
  },
  async ({ title, severity, description, steps_to_reproduce }) => {
    const report = {
      id: "BUG-" + Math.floor(Math.random() * 9000 + 1000),
      title,
      severity,
      description,
      steps_to_reproduce: steps_to_reproduce || "Not provided",
      status: "Open",
      assignee: "Unassigned",
      createdAt: new Date().toISOString(),
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
  }
);

// --- Tool: get-team-performance ---
server.tool(
  "get-team-performance",
  "Returns quarterly team performance data for bar chart visualization",
  {},
  async () => {
    const performance = {
      title: "Team Performance — Q1 2026",
      labels: ["Frontend", "Backend", "DevOps", "QA", "Design"],
      datasets: [
        { label: "Tasks Completed", data: [48, 62, 35, 41, 28] },
        { label: "Story Points", data: [142, 198, 95, 120, 78] },
      ],
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(performance) }] };
  }
);

// --- Tool: get-monthly-trends ---
server.tool(
  "get-monthly-trends",
  "Returns monthly trend data with labels and datasets for line chart visualization",
  {},
  async () => {
    const trends = {
      title: "Platform Growth — 2025",
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      datasets: [
        {
          label: "Active Users",
          data: [1200, 1350, 1580, 1720, 1950, 2200, 2450, 2680, 2900, 3150, 3400, 3800],
        },
        {
          label: "API Requests (k)",
          data: [45, 52, 61, 73, 85, 98, 112, 128, 145, 162, 180, 205],
        },
        {
          label: "Tool Executions (k)",
          data: [12, 15, 19, 24, 31, 38, 47, 55, 64, 75, 88, 102],
        },
      ],
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(trends, null, 2) }],
    };
  }
);

// --- Tool: get-category-breakdown ---
server.tool(
  "get-category-breakdown",
  "Returns category distribution data suitable for doughnut or bar chart visualization",
  {},
  async () => {
    const breakdown = {
      title: "MCP Server Usage by Category",
      labels: ["Filesystem", "Database", "API Gateway", "DevOps", "Analytics", "Communication"],
      datasets: [
        {
          label: "Tool Calls",
          data: [3420, 2850, 2100, 1780, 1250, 890],
        },
      ],
      summary: {
        totalCalls: 12290,
        mostPopular: "Filesystem",
        fastestGrowing: "DevOps",
        period: "Last 30 days",
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(breakdown, null, 2) }],
    };
  }
);

// --- Tool: search-knowledge-base ---
server.tool(
  "search-knowledge-base",
  "Search the knowledge base for articles by keyword or topic",
  { query: z.string().describe("Search query (e.g. 'getting started', 'troubleshooting', 'architecture')") },
  async ({ query }) => {
    const results = {
      query,
      totalResults: 12,
      sections: [
        {
          title: "Quick Start Guides",
          count: 4,
          articles: [
            { title: "Installing Burnish", status: "Published", author: "Alice Chen", updated: "2026-04-01", views: 2840 },
            { title: "Connecting Your First MCP Server", status: "Published", author: "Bob Martinez", updated: "2026-03-28", views: 1920 },
            { title: "Explorer Mode Tutorial", status: "Published", author: "Carol Williams", updated: "2026-04-05", views: 1540 },
            { title: "Custom Component Themes", status: "Draft", author: "David Kim", updated: "2026-04-09", views: 320 },
          ],
        },
        {
          title: "Architecture & Concepts",
          count: 4,
          articles: [
            { title: "How MCP Tool Calling Works", status: "Published", author: "Eva Singh", updated: "2026-03-15", views: 3100 },
            { title: "Component Rendering Pipeline", status: "Published", author: "Frank Osei", updated: "2026-03-20", views: 1680 },
            { title: "Streaming & Progressive Display", status: "Published", author: "Grace Tanaka", updated: "2026-04-02", views: 1250 },
            { title: "Security Model & Guards", status: "Review", author: "Henry Novak", updated: "2026-04-08", views: 890 },
          ],
        },
        {
          title: "Troubleshooting",
          count: 4,
          articles: [
            { title: "Common Connection Issues", status: "Published", author: "Alice Chen", updated: "2026-03-25", views: 4200 },
            { title: "Rate Limiting & Quotas", status: "Published", author: "Bob Martinez", updated: "2026-03-30", views: 1100 },
            { title: "Tool Execution Errors", status: "Published", author: "Carol Williams", updated: "2026-04-03", views: 2350 },
            { title: "Performance Tuning Guide", status: "Draft", author: "Eva Singh", updated: "2026-04-07", views: 450 },
          ],
        },
      ],
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start example server:", error);
  process.exit(1);
});
