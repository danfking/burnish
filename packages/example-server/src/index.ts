#!/usr/bin/env node
/**
 * @burnishdev/example-server
 *
 * A connected-graph demo MCP server. The dataset is a fictional consulting
 * company (clients, contacts, departments, team members, projects, tasks,
 * comments, incidents, incident logs, orders) wired together with
 * deterministic IDs so Burnish's drill-down navigation has somewhere to go.
 *
 * Tool surface (27 tools):
 *   - 8 entity types × 3 read tools (list / get / search) = 24
 *   - 3 write tools: create-task, add-comment, update-task-status
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildFixture, type FixtureStore } from "./fixtures.js";

const store: FixtureStore = buildFixture();

const server = new McpServer(
  {
    name: "burnish-example-server",
    version: "0.2.0",
  },
  {
    instructions:
      "A deep-graph demo MCP server for the Burnish Explorer. A fictional consulting company with projects, clients, team members, tasks, comments, incidents, and orders — all interconnected, so you can click from a project into a task into a comment into the comment's author and keep going. Showcases Burnish's drill-down navigation, auto-generated forms, and rich result rendering.",
  }
);

// ──────────────────────── Helpers ────────────────────────

function asText<T>(value: T): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function notFound(kind: string, id: string) {
  return asText({ error: `${kind} not found`, id });
}

function searchObjects<T extends Record<string, unknown>>(items: T[], query: string, keys: (keyof T)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter((item) =>
    keys.some((k) => {
      const v = item[k];
      return typeof v === "string" && v.toLowerCase().includes(q);
    })
  );
}

// ──────────────────────── Projects ────────────────────────

server.tool(
  "list-projects",
  "List all projects with status, client, and team size. Cards are clickable to show project details.",
  { status: z.enum(["planning", "active", "on-hold", "completed"]).optional().describe("Filter by status") },
  async ({ status }) => {
    const items = store.projects
      .filter((p) => !status || p.status === status)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        clientId: p.clientId,
        leadMemberId: p.leadMemberId,
        teamSize: p.teamMemberIds.length,
        startDate: p.startDate,
        description: p.description,
      }));
    return asText(items);
  }
);

server.tool(
  "get-project",
  "Get detailed information for a single project, including its team, tasks, and orders.",
  { projectId: z.string().describe("Project id, e.g. 'project-1'") },
  async ({ projectId }) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return notFound("project", projectId);

    const client = store.clients.find((c) => c.id === project.clientId);
    const lead = store.members.find((m) => m.id === project.leadMemberId);
    const team = project.teamMemberIds
      .map((id) => store.members.find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => ({ id: m!.id, name: m!.name, role: m!.role, department: m!.department, email: m!.email }));
    const tasks = store.tasks
      .filter((t) => t.projectId === projectId)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assigneeId: t.assigneeId, dueDate: t.dueDate }));
    const orders = store.orders
      .filter((o) => o.projectId === projectId)
      .map((o) => ({ id: o.id, status: o.status, amount: o.amount, orderDate: o.orderDate, clientId: o.clientId }));

    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: project.id,
          name: project.name,
          status: project.status,
          startDate: project.startDate,
          description: project.description,
          clientName: client?.name,
          leadName: lead?.name,
          teamSize: team.length,
          taskCount: tasks.length,
          orderCount: orders.length,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(team, null, 2) },
        { type: "text" as const, text: JSON.stringify(tasks, null, 2) },
        { type: "text" as const, text: JSON.stringify(orders, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-projects",
  "Search projects by name or description.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.projects as unknown as Record<string, unknown>[], query, ["name", "description"]);
    return asText(matches);
  }
);

// ──────────────────────── Clients ────────────────────────

server.tool(
  "list-clients",
  "List all clients with their industry and contact count.",
  {},
  async () => {
    const items = store.clients.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      contactCount: c.contactIds.length,
    }));
    return asText(items);
  }
);

server.tool(
  "get-client",
  "Get detailed information for a single client, including its contacts, projects, and orders.",
  { clientId: z.string().describe("Client id, e.g. 'client-1'") },
  async ({ clientId }) => {
    const client = store.clients.find((c) => c.id === clientId);
    if (!client) return notFound("client", clientId);
    const contacts = store.contacts.filter((c) => c.clientId === clientId);
    const projects = store.projects.filter((p) => p.clientId === clientId).map((p) => ({
      id: p.id, name: p.name, status: p.status, startDate: p.startDate,
    }));
    const orders = store.orders.filter((o) => o.clientId === clientId).map((o) => ({
      id: o.id, projectId: o.projectId, amount: o.amount, status: o.status, orderDate: o.orderDate,
    }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: client.id,
          name: client.name,
          industry: client.industry,
          contactCount: contacts.length,
          projectCount: projects.length,
          orderCount: orders.length,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(contacts, null, 2) },
        { type: "text" as const, text: JSON.stringify(projects, null, 2) },
        { type: "text" as const, text: JSON.stringify(orders, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-clients",
  "Search clients by name or industry.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.clients as unknown as Record<string, unknown>[], query, ["name", "industry"]);
    return asText(matches);
  }
);

// ──────────────────────── Contacts ────────────────────────

server.tool(
  "list-contacts",
  "List all contacts across all clients.",
  { clientId: z.string().optional().describe("Optional client id to filter") },
  async ({ clientId }) => {
    const items = store.contacts
      .filter((c) => !clientId || c.clientId === clientId)
      .map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, clientId: c.clientId }));
    return asText(items);
  }
);

server.tool(
  "get-contact",
  "Get detailed information for a single contact.",
  { contactId: z.string().describe("Contact id, e.g. 'contact-1'") },
  async ({ contactId }) => {
    const contact = store.contacts.find((c) => c.id === contactId);
    if (!contact) return notFound("contact", contactId);
    const client = store.clients.find((c) => c.id === contact.clientId);
    return asText({ ...contact, clientName: client?.name });
  }
);

server.tool(
  "search-contacts",
  "Search contacts by name, email, or role.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.contacts as unknown as Record<string, unknown>[], query, ["name", "email", "role"]);
    return asText(matches);
  }
);

// ──────────────────────── Team members ────────────────────────

server.tool(
  "list-team-members",
  "List all team members with their role and department.",
  { department: z.string().optional().describe("Filter by department name") },
  async ({ department }) => {
    const items = store.members
      .filter((m) => !department || m.department === department)
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        department: m.department,
        email: m.email,
        projectCount: m.projectIds.length,
        taskCount: m.taskIds.length,
      }));
    return asText(items);
  }
);

server.tool(
  "get-team-member",
  "Get detailed information for a single team member, including their projects and tasks.",
  { memberId: z.string().describe("Team member id, e.g. 'member-1'") },
  async ({ memberId }) => {
    const member = store.members.find((m) => m.id === memberId);
    if (!member) return notFound("team-member", memberId);
    const projects = member.projectIds
      .map((id) => store.projects.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({ id: p!.id, name: p!.name, status: p!.status }));
    const tasks = store.tasks
      .filter((t) => t.assigneeId === memberId)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId, dueDate: t.dueDate }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          department: member.department,
          skills: member.skills,
          managerId: member.managerId,
          projectCount: projects.length,
          taskCount: tasks.length,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(projects, null, 2) },
        { type: "text" as const, text: JSON.stringify(tasks, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-team-members",
  "Search team members by name, email, role, or skill.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const q = query.trim().toLowerCase();
    const matches = store.members.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q) ||
      m.skills.some((s) => s.toLowerCase().includes(q))
    ).map((m) => ({ id: m.id, name: m.name, role: m.role, department: m.department, email: m.email }));
    return asText(matches);
  }
);

// ──────────────────────── Tasks ────────────────────────

server.tool(
  "list-tasks",
  "List tasks with optional filters by project, status, or priority.",
  {
    projectId: z.string().optional().describe("Filter by project id"),
    status: z.enum(["todo", "in-progress", "done", "blocked"]).optional().describe("Filter by status"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by priority"),
  },
  async ({ projectId, status, priority }) => {
    const items = store.tasks
      .filter((t) => (!projectId || t.projectId === projectId) &&
        (!status || t.status === status) &&
        (!priority || t.priority === priority))
      .slice(0, 100)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        projectId: t.projectId,
        assigneeId: t.assigneeId,
        dueDate: t.dueDate,
      }));
    return asText(items);
  }
);

server.tool(
  "get-task",
  "Get detailed information for a single task, including its comments and subtasks.",
  { taskId: z.string().describe("Task id, e.g. 'task-1'") },
  async ({ taskId }) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return notFound("task", taskId);
    const project = store.projects.find((p) => p.id === task.projectId);
    const assignee = store.members.find((m) => m.id === task.assigneeId);
    const reporter = store.members.find((m) => m.id === task.reporterId);
    const comments = store.comments
      .filter((c) => c.taskId === taskId)
      .map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, createdAt: c.createdAt, replyToId: c.replyToId }));
    const subtasks = task.subtaskIds
      .map((id) => store.tasks.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => ({ id: t!.id, title: t!.title, status: t!.status, priority: t!.priority }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          projectName: project?.name,
          assigneeName: assignee?.name,
          reporterName: reporter?.name,
          dueDate: task.dueDate,
          commentCount: comments.length,
          subtaskCount: subtasks.length,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(comments, null, 2) },
        { type: "text" as const, text: JSON.stringify(subtasks, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-tasks",
  "Search tasks by title or description.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.tasks as unknown as Record<string, unknown>[], query, ["title", "description"])
      .slice(0, 50)
      .map((t: any) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId,
      }));
    return asText(matches);
  }
);

// ──────────────────────── Comments ────────────────────────

server.tool(
  "list-comments",
  "List comments, optionally filtered by task.",
  { taskId: z.string().optional().describe("Filter by task id") },
  async ({ taskId }) => {
    const items = store.comments
      .filter((c) => !taskId || c.taskId === taskId)
      .slice(0, 100)
      .map((c) => ({ id: c.id, taskId: c.taskId, authorId: c.authorId, body: c.body, createdAt: c.createdAt }));
    return asText(items);
  }
);

server.tool(
  "get-comment",
  "Get detailed information for a single comment.",
  { commentId: z.string().describe("Comment id, e.g. 'comment-1'") },
  async ({ commentId }) => {
    const comment = store.comments.find((c) => c.id === commentId);
    if (!comment) return notFound("comment", commentId);
    const author = store.members.find((m) => m.id === comment.authorId);
    const task = store.tasks.find((t) => t.id === comment.taskId);
    return asText({
      ...comment,
      authorName: author?.name,
      authorRole: author?.role,
      taskTitle: task?.title,
    });
  }
);

server.tool(
  "search-comments",
  "Search comments by body text.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.comments as unknown as Record<string, unknown>[], query, ["body"])
      .slice(0, 50);
    return asText(matches);
  }
);

// ──────────────────────── Incidents ────────────────────────

server.tool(
  "list-incidents",
  "List incidents with optional severity filter.",
  { severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by severity") },
  async ({ severity }) => {
    const items = store.incidents
      .filter((i) => !severity || i.severity === severity)
      .map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        reportedByMemberId: i.reportedByMemberId,
        affectedProjects: i.affectedProjectIds.length,
        logCount: i.logIds.length,
      }));
    return asText(items);
  }
);

server.tool(
  "get-incident",
  "Get detailed information for a single incident, including its logs and related tasks.",
  { incidentId: z.string().describe("Incident id, e.g. 'incident-1'") },
  async ({ incidentId }) => {
    const incident = store.incidents.find((i) => i.id === incidentId);
    if (!incident) return notFound("incident", incidentId);
    const reporter = store.members.find((m) => m.id === incident.reportedByMemberId);
    const logs = store.incidentLogs
      .filter((l) => l.incidentId === incidentId)
      .map((l) => ({ id: l.id, timestamp: l.timestamp, message: l.message, authorMemberId: l.authorMemberId }));
    const relatedTasks = incident.relatedTaskIds
      .map((id) => store.tasks.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => ({ id: t!.id, title: t!.title, status: t!.status, projectId: t!.projectId }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          reporterName: reporter?.name,
          affectedProjectIds: incident.affectedProjectIds,
          logCount: logs.length,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(logs, null, 2) },
        { type: "text" as const, text: JSON.stringify(relatedTasks, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-incidents",
  "Search incidents by title.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const matches = searchObjects(store.incidents as unknown as Record<string, unknown>[], query, ["title"]);
    return asText(matches);
  }
);

// ──────────────────────── Orders ────────────────────────

server.tool(
  "list-orders",
  "List orders with optional status filter.",
  { status: z.enum(["pending", "paid", "overdue"]).optional().describe("Filter by status") },
  async ({ status }) => {
    const items = store.orders
      .filter((o) => !status || o.status === status)
      .map((o) => ({
        id: o.id,
        clientId: o.clientId,
        projectId: o.projectId,
        amount: o.amount,
        status: o.status,
        orderDate: o.orderDate,
      }));
    return asText(items);
  }
);

server.tool(
  "get-order",
  "Get detailed information for a single order, including its line items.",
  { orderId: z.string().describe("Order id, e.g. 'order-1'") },
  async ({ orderId }) => {
    const order = store.orders.find((o) => o.id === orderId);
    if (!order) return notFound("order", orderId);
    const client = store.clients.find((c) => c.id === order.clientId);
    const project = store.projects.find((p) => p.id === order.projectId);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({
          id: order.id,
          amount: order.amount,
          status: order.status,
          orderDate: order.orderDate,
          clientName: client?.name,
          projectName: project?.name,
        }, null, 2) },
        { type: "text" as const, text: JSON.stringify(order.lineItems, null, 2) },
      ],
    };
  }
);

server.tool(
  "search-orders",
  "Search orders by line-item description.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const q = query.trim().toLowerCase();
    const matches = store.orders.filter((o) =>
      o.lineItems.some((li) => li.description.toLowerCase().includes(q))
    ).map((o) => ({ id: o.id, clientId: o.clientId, projectId: o.projectId, amount: o.amount, status: o.status }));
    return asText(matches);
  }
);

// ──────────────────────── Write tools ────────────────────────

server.tool(
  "create-task",
  "Create a new task in an existing project. Demonstrates write-confirmation and form generation.",
  {
    title: z.string().describe("Task title"),
    description: z.string().describe("Detailed description"),
    projectId: z.string().describe("Project id this task belongs to"),
    assigneeId: z.string().describe("Team member id of the assignee"),
    priority: z.enum(["low", "medium", "high", "critical"]).describe("Task priority"),
  },
  async ({ title, description, projectId, assigneeId, priority }) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return notFound("project", projectId);
    const assignee = store.members.find((m) => m.id === assigneeId);
    if (!assignee) return notFound("team-member", assigneeId);

    const id = `task-${store.nextTaskId++}`;
    const newTask = {
      id,
      title,
      description,
      status: "todo" as const,
      priority,
      projectId,
      assigneeId,
      reporterId: project.leadMemberId,
      dueDate: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
      subtaskIds: [],
      commentIds: [],
    };
    store.tasks.push(newTask);
    assignee.taskIds.push(id);
    return asText({ created: true, task: newTask });
  }
);

server.tool(
  "add-comment",
  "Add a comment to an existing task. Optionally as a reply to another comment.",
  {
    taskId: z.string().describe("Task id to comment on"),
    body: z.string().describe("Comment body"),
    replyToId: z.string().optional().describe("Optional parent comment id"),
  },
  async ({ taskId, body, replyToId }) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return notFound("task", taskId);
    const id = `comment-${store.nextCommentId++}`;
    const newComment = {
      id,
      taskId,
      authorId: "member-1", // attributed to a fixture user
      body,
      createdAt: new Date().toISOString(),
      replyToId: replyToId ?? null,
    };
    store.comments.push(newComment);
    task.commentIds.push(id);
    return asText({ created: true, comment: newComment });
  }
);

server.tool(
  "update-task-status",
  "Update the status of an existing task.",
  {
    taskId: z.string().describe("Task id"),
    status: z.enum(["todo", "in-progress", "done", "blocked"]).describe("New status"),
  },
  async ({ taskId, status }) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return notFound("task", taskId);
    const previous = task.status;
    task.status = status;
    return asText({ updated: true, taskId, previous, current: status });
  }
);

// ──────────────────────── Showcase: severity enum form ────────────────────────
// Retained from the previous example-server because it's the canonical demo
// of enum-driven form generation (regression case for #377).

server.tool(
  "create-bug-report",
  "Submit a bug report with details for tracking. Showcases enum-driven form generation.",
  {
    title: z.string().describe("Bug title"),
    severity: z.enum(["low", "medium", "high", "critical"]).describe("Severity level"),
    description: z.string().describe("Detailed description of the bug"),
    steps_to_reproduce: z.string().optional().describe("Steps to reproduce the issue"),
  },
  async ({ title, severity, description, steps_to_reproduce }) => {
    const report = {
      id: "BUG-" + (1000 + store.tasks.length),
      title,
      severity,
      description,
      steps_to_reproduce: steps_to_reproduce || "Not provided",
      status: "Open",
      assignee: "Unassigned",
      createdAt: new Date().toISOString(),
    };
    return asText(report);
  }
);

// ──────────────────────── Showcase: component gallery ────────────────────────
// These tools each exercise one of Burnish's 10 web components, so the README
// and docs can link to live examples of every render path.

server.tool(
  "get-revenue-chart",
  "Monthly revenue over the last 6 months as a line chart. Demonstrates <burnish-chart>.",
  {},
  async () => {
    return asText({
      title: "Monthly revenue",
      labels: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
      datasets: [
        { label: "Revenue (AUD)", data: [142000, 158000, 151000, 178000, 192000, 215000] },
      ],
    });
  }
);

server.tool(
  "get-team-distribution",
  "Headcount by department as a doughnut chart. Demonstrates <burnish-chart>.",
  {},
  async () => {
    const byDept: Record<string, number> = {};
    for (const m of store.members) {
      byDept[m.department] = (byDept[m.department] || 0) + 1;
    }
    return asText({
      title: "Team by department",
      labels: Object.keys(byDept),
      datasets: [{ label: "Headcount", data: Object.values(byDept) }],
    });
  }
);

server.tool(
  "get-dashboard-overview",
  "Company dashboard with summary stats, project table, and revenue chart in one response. Demonstrates <burnish-section> multi-section rendering.",
  {},
  async () => {
    const activeProjects = store.projects.filter((p) => p.status === "active").length;
    const openTasks = store.tasks.filter((t) => t.status !== "done").length;
    const criticalIncidents = store.incidents.filter((i) => i.severity === "critical").length;
    const totalRevenue = store.orders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.amount, 0);

    const stats = [
      { label: "Active Projects", value: activeProjects, color: "success" },
      { label: "Open Tasks", value: openTasks, color: "info" },
      { label: "Critical Incidents", value: criticalIncidents, color: criticalIncidents > 0 ? "error" : "muted" },
      { label: "Paid Revenue", value: `$${(totalRevenue / 1000).toFixed(0)}k`, color: "success" },
    ];

    const topProjects = store.projects
      .filter((p) => p.status === "active")
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        teamSize: p.teamMemberIds.length,
        startDate: p.startDate,
      }));

    const revenueChart = {
      title: "Revenue trend",
      labels: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
      datasets: [
        { label: "Revenue (AUD)", data: [142000, 158000, 151000, 178000, 192000, 215000] },
      ],
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats) },
        { type: "text" as const, text: JSON.stringify(topProjects) },
        { type: "text" as const, text: JSON.stringify(revenueChart) },
      ],
    };
  }
);

server.tool(
  "get-status-report",
  "Generate a narrative weekly status report. Demonstrates <burnish-message> long-text rendering.",
  {},
  async () => {
    const report = [
      "# Weekly Status — Week of " + new Date().toISOString().slice(0, 10),
      "",
      "This week the team closed 18 tasks across 4 active projects, marking the highest throughput in the current quarter. The Apollo Platform milestone shipped on schedule, and Helios Dashboard is tracking green for its end-of-month launch.",
      "",
      "Two critical incidents were resolved within SLA. The underlying cause — a misconfigured load balancer — has been addressed and a postmortem is being drafted. No customer-facing outages occurred.",
      "",
      "Heading into next week, the Pulsar Sync project enters QA, and the Vega Analytics team begins integration testing with the new data warehouse. Expect a temporary dip in shipped features as integration work is less visible from the outside.",
    ].join("\n");
    return { content: [{ type: "text" as const, text: report }] };
  }
);

server.tool(
  "get-suggested-actions",
  "Recommended next actions after reviewing a dashboard. Demonstrates <burnish-actions>.",
  {},
  async () => {
    return asText({
      _ui_hint: "actions",
      actions: [
        { label: "View active projects", action: "read", prompt: "List all active projects", icon: "list" },
        { label: "Check critical incidents", action: "read", prompt: "List critical incidents", icon: "alert" },
        { label: "Create a task", action: "write", prompt: "Create a new task", icon: "edit" },
        { label: "Generate status report", action: "read", prompt: "Generate weekly status report", icon: "document" },
      ],
    });
  }
);

server.tool(
  "get-pipeline-status",
  "Current deploy pipeline stages with status for each step. Demonstrates <burnish-pipeline>.",
  {},
  async () => {
    return asText({
      _ui_hint: "pipeline",
      steps: [
        { server: "ci", tool: "build", status: "success" },
        { server: "ci", tool: "test", status: "success" },
        { server: "ci", tool: "lint", status: "success" },
        { server: "deploy", tool: "stage-deploy", status: "success" },
        { server: "deploy", tool: "smoke-test", status: "running" },
        { server: "deploy", tool: "prod-deploy", status: "pending" },
      ],
    });
  }
);

// ──────────────────────── Start server ────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start example server:", error);
  process.exit(1);
});
