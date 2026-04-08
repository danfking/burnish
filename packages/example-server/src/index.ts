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

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start example server:", error);
  process.exit(1);
});
