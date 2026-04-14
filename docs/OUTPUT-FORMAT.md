# Output Format Guide for MCP Server Authors

Burnish auto-maps your MCP tool responses to visual components based on their JSON shape. You don't need to know about Burnish components — just return well-structured JSON and Burnish picks the right visualization.

This guide shows which JSON patterns trigger which components, so you can optimize your server's output for the best visual experience.

## Quick Reference

| Your JSON shape | Burnish renders |
|---|---|
| Array of uniform objects | Table (sortable, filterable) |
| Array of `{label, value}` objects | Stat bar (metric chips) |
| Single object, ≤8 fields | Card (title + metadata) |
| Single number or short string | Metric (KPI display) |
| Chart.js-shaped data | Chart (line/bar/doughnut) |
| Long text (>50 chars) | Message bubble |

## Table — Arrays of Objects

Return an array of uniform objects. Each object becomes a row, each key becomes a column.

```json
[
  { "id": "proj-1", "name": "Website Redesign", "status": "active", "tasks": 12 },
  { "id": "proj-2", "name": "API Migration", "status": "completed", "tasks": 8 },
  { "id": "proj-3", "name": "Mobile App", "status": "draft", "tasks": 24 }
]
```

**Result:** A sortable, filterable table with pagination. Columns are auto-generated from object keys and labeled in Title Case.

**Tips:**
- Include an `id` field to enable drill-down navigation (Burnish renders "Explore" links)
- Include a `status` field for automatic color-coding (green for success/active, red for error/failing, amber for warning/draft)
- Keep column count reasonable (4-8 fields per row works best)
- Use consistent keys across all objects in the array

## Stat Bar — Summary Metrics

Return an array of objects with `label` and `value` (and optionally `color`).

```json
[
  { "label": "Active", "value": 150, "color": "success" },
  { "label": "Pending", "value": 12, "color": "warning" },
  { "label": "Failed", "value": 2, "color": "error" }
]
```

**Result:** Horizontal row of colored metric chips.

**Color values:** `success` (green), `warning` (amber), `error` (red), `info` (blue), `muted` (gray). You can also use descriptive words like `healthy`, `failing`, `draft`.

**Tips:**
- Keep to 2-5 items for readability
- Objects must have exactly 2-3 keys (`label`, `value`, and optionally `color`)
- Works well as a summary before a detailed listing

## Card — Single Entity Detail

Return a single object with up to 8 fields. Burnish picks the title from `name`, `title`, or `id` (first one found).

```json
{
  "id": "proj-42",
  "name": "Website Redesign",
  "status": "active",
  "client": "Acme Corp",
  "teamSize": 8,
  "startDate": "2026-01-15",
  "budget": "$50,000"
}
```

**Result:** A card with the title "Website Redesign", status badge, and remaining fields as labeled metadata.

**Tips:**
- Include `status` for automatic color-coded badge
- Include `id` to enable drill-down navigation
- Keep to ≤8 fields (more than 8 renders as a key-value table instead)

## Metric — Single KPI

Return a single number or short string (≤50 characters).

```json
42
```

or

```json
"99.9%"
```

**Result:** A large KPI display showing the value prominently.

**Tips:**
- For richer metrics, return an object with `label`, `value`, `unit`, and `trend`:
  ```json
  { "label": "API Uptime", "value": "99.9", "unit": "%", "trend": "up" }
  ```
- Trend values: `up` (green arrow), `down` (red arrow), `flat` (gray arrow)

## Chart — Visualizations

Return data in Chart.js format with `labels` and `datasets`:

```json
{
  "labels": ["Jan", "Feb", "Mar", "Apr", "May"],
  "datasets": [
    {
      "label": "Revenue",
      "data": [12000, 15000, 13500, 18000, 21000]
    }
  ]
}
```

**Result:** A line chart. Burnish auto-detects chart data by the presence of `labels` and `datasets` keys.

**Tips:**
- Supports line, bar, and doughnut chart types
- Multiple datasets render as overlaid series
- Use `borderColor` and `backgroundColor` for custom colors

## Multi-Section Responses

Return multiple JSON objects as separate content items to create multi-section views:

```typescript
return {
  content: [
    { type: "text", text: JSON.stringify(summaryStats) },   // → stat bar
    { type: "text", text: JSON.stringify(projectList) },     // → table
    { type: "text", text: JSON.stringify(recentActivity) },  // → table
  ],
};
```

Each content item is auto-mapped independently, so you can mix cards, tables, and stats in a single response.

## Drill-Down Navigation

Burnish's most powerful feature works automatically: when a tool result contains an ID field that matches another tool's input parameter, Burnish renders it as a clickable "Explore" link.

**Example:** If your `list-projects` tool returns objects with `id` fields, and you have a `get-project` tool that accepts an `id` parameter, Burnish links them automatically. Users can click through from list → detail → related entities without any configuration.

**To enable drill-down:**
1. Use consistent ID field names across tools (e.g., `id`, `projectId`, `taskId`)
2. Name your detail tools predictably (`get-project`, `get-task`)
3. Accept the entity ID as an input parameter with the same name as the output field

## Status Color Reference

These field values trigger automatic color-coding in cards, tables, and stat bars:

| Color | Values |
|---|---|
| Green | `success`, `active`, `healthy`, `passing`, `resolved`, `completed` |
| Amber | `warning`, `draft`, `pending`, `review` |
| Red | `error`, `failing`, `critical`, `blocked` |
| Blue | `info` |
| Gray | `muted`, `inactive`, `archived` |

## Complete Example Server

Here's a minimal MCP server optimized for Burnish rendering:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// List → renders as table with drill-down links
server.tool("list-items", "List all items", {
  status: z.enum(["active", "archived"]).optional(),
}, async ({ status }) => {
  const items = getItems(status);
  return {
    content: [{ type: "text", text: JSON.stringify(items) }],
  };
});

// Get → renders as card + related tables
server.tool("get-item", "Get item details", {
  id: z.string(),
}, async ({ id }) => {
  const item = getItem(id);
  const history = getItemHistory(id);
  return {
    content: [
      { type: "text", text: JSON.stringify(item) },
      { type: "text", text: JSON.stringify(history) },
    ],
  };
});

// Stats → renders as stat bar
server.tool("item-stats", "Get item statistics", {}, async () => {
  return {
    content: [{
      type: "text",
      text: JSON.stringify([
        { label: "Active", value: 42, color: "success" },
        { label: "Archived", value: 15, color: "muted" },
      ]),
    }],
  };
});
```

## Tips for Best Results

1. **Return JSON, not prose.** Burnish auto-maps structured data to rich components. Plain text gets rendered as a message bubble.
2. **Use consistent field names.** `id`, `name`, `status` are recognized automatically for titles, drill-down, and color coding.
3. **Keep objects uniform.** Arrays of objects should have the same keys in every item for clean table rendering.
4. **Include status fields.** Any field named `status`, `state`, or `severity` triggers automatic color coding.
5. **Prefer arrays for lists.** Even if you only have one result, wrapping it in an array triggers table rendering with sorting and filtering.
