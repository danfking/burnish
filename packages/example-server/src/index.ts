#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
    const salesData = {
      period: "2025 Q1-Q4",
      currency: "USD",
      totalRevenue: "$1,466,000",
      topCategory: "Software",
      growthRate: "97.6%",
      averageMonthly: "$122,167",
      janTotal: "$85,000",
      febTotal: "$92,000",
      marTotal: "$99,000",
      q1Revenue: "$276,000",
      aprTotal: "$105,000",
      mayTotal: "$111,000",
      junTotal: "$121,000",
      q2Revenue: "$337,000",
      julTotal: "$128,000",
      augTotal: "$131,000",
      sepTotal: "$128,000",
      q3Revenue: "$387,000",
      octTotal: "$150,000",
      novTotal: "$148,000",
      decTotal: "$168,000",
      q4Revenue: "$466,000",
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(salesData, null, 2) },
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
      name: "Production Release v2.4.1",
      triggeredBy: "Alice Chen",
      startedAt: "2026-04-10T09:15:00Z",
      stages: [
        { name: "Build", status: "success", duration: "2m 14s", details: "TypeScript compiled, 0 errors" },
        { name: "Unit Tests", status: "success", duration: "1m 48s", details: "342 tests passed" },
        { name: "Integration Tests", status: "success", duration: "4m 32s", details: "28 suites, all green" },
        { name: "Security Scan", status: "running", duration: "1m 05s", details: "Scanning dependencies..." },
        { name: "Staging Deploy", status: "pending", duration: null, details: "Waiting for security scan" },
        { name: "Production Deploy", status: "pending", duration: null, details: "Requires manual approval" },
      ],
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(pipeline, null, 2) }],
    };
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
  "Returns grouped knowledge base articles organized by section, with status and metadata",
  {},
  async () => {
    const results = {
      query: "getting started",
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
