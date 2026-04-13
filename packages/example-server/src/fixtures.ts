/**
 * Deterministic in-memory fixture for the Burnish example MCP server.
 *
 * No randomness, no external IO. Entity IDs are stable and predictable so
 * test runs and drill-down chains are reproducible.
 *
 * Entity counts (target):
 *   5 clients, 15 contacts, 5 departments, 40 team members,
 *   10 projects, 200 tasks, 500 comments, 50 incidents,
 *   ~300 incident logs, 100 orders.
 */

// ───────────────────────────── Types ─────────────────────────────

export interface Client {
  id: string;
  name: string;
  industry: string;
  contactIds: string[];
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  clientId: string;
  role: string;
}

export interface Department {
  id: string;
  name: string;
  headMemberId: string;
  memberIds: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  skills: string[];
  managerId: string | null;
  projectIds: string[];
  taskIds: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "on-hold" | "completed";
  clientId: string;
  leadMemberId: string;
  startDate: string;
  teamMemberIds: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "done" | "blocked";
  priority: "low" | "medium" | "high" | "critical";
  projectId: string;
  assigneeId: string;
  reporterId: string;
  dueDate: string;
  subtaskIds: string[];
  commentIds: string[];
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  replyToId: string | null;
}

export interface Incident {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "mitigated" | "resolved";
  reportedByMemberId: string;
  affectedProjectIds: string[];
  relatedTaskIds: string[];
  logIds: string[];
}

export interface IncidentLog {
  id: string;
  incidentId: string;
  timestamp: string;
  message: string;
  authorMemberId: string;
}

export interface Order {
  id: string;
  clientId: string;
  projectId: string;
  amount: number;
  status: "pending" | "paid" | "overdue";
  orderDate: string;
  lineItems: { description: string; qty: number; unit: number }[];
}

// ──────────────────────── Static word banks ────────────────────────

const FIRST_NAMES = [
  "Alice","Bob","Carol","David","Eva","Frank","Grace","Henry","Iris","Jay",
  "Kira","Liam","Mona","Nico","Olive","Pat","Quinn","Reza","Sara","Theo",
  "Uma","Vik","Wren","Xan","Yara","Zach","Anya","Ben","Cleo","Dean",
  "Elise","Faisal","Gia","Hugo","Ines","Juno","Kai","Lara","Milo","Nora",
];
const LAST_NAMES = [
  "Chen","Martinez","Williams","Kim","Singh","Osei","Tanaka","Novak","Walsh","Park",
  "Reyes","Hassan","Patel","Brown","Garcia","Schmidt","Larsen","Romano","Cohen","Ali",
  "Nguyen","Okafor","Petrov","Silva","Andersen","Cruz","Holm","Mendez","Ross","Wagner",
  "Bauer","Iqbal","Khan","Lopez","Murphy","Pierce","Quan","Reid","Stone","Turner",
];
const DEPARTMENTS = ["Engineering", "Design", "Product", "Operations", "Sales"];
const SKILLS_POOL = [
  "TypeScript","React","Node","Python","Go","Rust","SQL","Docker",
  "Kubernetes","AWS","GCP","Figma","Postgres","Redis","GraphQL","REST",
  "Playwright","CI/CD","OAuth","Lit",
];
const ROLES_BY_DEPT: Record<string, string[]> = {
  Engineering: ["Engineer", "Senior Engineer", "Staff Engineer", "Tech Lead"],
  Design: ["Designer", "Senior Designer", "Design Lead"],
  Product: ["PM", "Senior PM", "Group PM"],
  Operations: ["Ops Engineer", "SRE", "Ops Lead"],
  Sales: ["AE", "Senior AE", "Sales Lead"],
};
const PROJECT_NAMES = [
  "Apollo Platform","Helios Dashboard","Orion Gateway","Vega Analytics","Pulsar Sync",
  "Quasar Console","Nova Insights","Lyra Mobile","Atlas Billing","Cygnus Auth",
];
const PROJECT_STATUSES: Project["status"][] = ["planning","active","active","active","on-hold","completed"];
const TASK_VERBS = ["Implement","Fix","Refactor","Document","Investigate","Optimize","Test","Migrate","Design","Review"];
const TASK_NOUNS = [
  "login flow","user dashboard","payment webhook","schema validator","cache layer",
  "search index","onboarding wizard","permissions matrix","export pipeline","audit log",
  "rate limiter","email digest","OAuth callback","feature flag","metrics endpoint",
];
const TASK_STATUSES: Task["status"][] = ["todo","in-progress","done","blocked","done","in-progress","todo","done"];
const PRIORITIES: Task["priority"][] = ["low","medium","high","critical","medium","low","high","medium"];
const CLIENT_NAMES = ["Northwind Trading","Globex Industries","Acme Corp","Initech","Umbrella Health"];
const INDUSTRIES = ["Logistics","Manufacturing","Retail","Software","Healthcare"];
const INCIDENT_TITLES = [
  "API latency spike","Database connection exhaustion","Auth token leak",
  "CDN cache poisoning","Failed deploy rollback","Memory leak in worker",
  "Rate limit bypass","SSL cert expiry","Stale read replica","Queue backlog",
];
const INCIDENT_SEVERITIES: Incident["severity"][] = ["low","medium","high","critical","medium","high"];
const INCIDENT_STATUSES: Incident["status"][] = ["open","investigating","mitigated","resolved","resolved","resolved"];
const ORDER_STATUSES: Order["status"][] = ["pending","paid","paid","paid","overdue"];
const COMMENT_BODIES = [
  "Looking into this now.","I can repro on staging.","Not blocking, will pick up after #refactor.",
  "Pushed a fix in the latest branch — please review.","Approved. Merging once CI is green.",
  "This needs design review before we ship.","Reverted due to perf regression.","Adding tests, will update.",
  "Discussed in standup — moving to next sprint.","Closing as duplicate of an earlier ticket.",
];

// ──────────────────────── Helpers ────────────────────────

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}
function dateNDaysAgo(n: number): string {
  // anchor: 2026-04-12
  const anchor = Date.UTC(2026, 3, 12);
  const ms = anchor - n * 86400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
function timestampNDaysAgo(n: number, hour: number): string {
  const anchor = Date.UTC(2026, 3, 12, hour, 0, 0);
  const ms = anchor - n * 86400_000;
  return new Date(ms).toISOString();
}

// ──────────────────────── Builders ────────────────────────

function buildClients(): Client[] {
  return CLIENT_NAMES.map((name, i) => ({
    id: `client-${i + 1}`,
    name,
    industry: INDUSTRIES[i],
    contactIds: [], // filled after contacts built
  }));
}

function buildContacts(clients: Client[]): Contact[] {
  const contacts: Contact[] = [];
  for (let i = 0; i < 15; i++) {
    const clientIdx = i % 5;
    const id = `contact-${i + 1}`;
    const first = pick(FIRST_NAMES, i + 7);
    const last = pick(LAST_NAMES, i + 11);
    contacts.push({
      id,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${clients[clientIdx].name.toLowerCase().replace(/\s+/g, "")}.example`,
      phone: `+1-555-${String(100 + i * 7).padStart(4, "0")}`,
      clientId: clients[clientIdx].id,
      role: pick(["CTO","Procurement","Engineering Manager","Director","Finance Lead"], i),
    });
    clients[clientIdx].contactIds.push(id);
  }
  return contacts;
}

function buildDepartments(): Department[] {
  return DEPARTMENTS.map((name, i) => ({
    id: `dept-${i + 1}`,
    name,
    headMemberId: "", // filled later
    memberIds: [],
  }));
}

function buildTeamMembers(departments: Department[]): TeamMember[] {
  const members: TeamMember[] = [];
  for (let i = 0; i < 40; i++) {
    const deptIdx = i % 5;
    const dept = departments[deptIdx];
    const first = pick(FIRST_NAMES, i);
    const last = pick(LAST_NAMES, i + 3);
    const role = pick(ROLES_BY_DEPT[dept.name], i);
    const skills = [
      pick(SKILLS_POOL, i),
      pick(SKILLS_POOL, i + 5),
      pick(SKILLS_POOL, i + 11),
    ];
    const id = `member-${i + 1}`;
    members.push({
      id,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@burnish.example`,
      role,
      department: dept.name,
      skills,
      managerId: i < 5 ? null : `member-${(i % 5) + 1}`, // first 5 are managers
      projectIds: [],
      taskIds: [],
    });
    dept.memberIds.push(id);
    if (i < 5) dept.headMemberId = id;
  }
  return members;
}

function buildProjects(clients: Client[], members: TeamMember[]): Project[] {
  const projects: Project[] = [];
  for (let i = 0; i < 10; i++) {
    const teamSize = 5 + (i % 4);
    const teamMemberIds: string[] = [];
    for (let j = 0; j < teamSize; j++) {
      teamMemberIds.push(`member-${((i * 4 + j) % 40) + 1}`);
    }
    const leadMemberId = `member-${(i % 5) + 1}`; // department heads lead
    const id = `project-${i + 1}`;
    projects.push({
      id,
      name: PROJECT_NAMES[i],
      description: `Strategic initiative for ${pick(CLIENT_NAMES, i)} covering platform modernization, observability, and rollout.`,
      status: pick(PROJECT_STATUSES, i),
      clientId: `client-${(i % 5) + 1}`,
      leadMemberId,
      startDate: dateNDaysAgo(700 - i * 60),
      teamMemberIds,
    });
    for (const mid of teamMemberIds) {
      const m = members.find((mm) => mm.id === mid);
      if (m && !m.projectIds.includes(id)) m.projectIds.push(id);
    }
  }
  return projects;
}

function buildTasks(projects: Project[], members: TeamMember[]): Task[] {
  const tasks: Task[] = [];
  for (let i = 0; i < 200; i++) {
    const projectIdx = i % 10;
    const project = projects[projectIdx];
    const assigneeIdx = i % project.teamMemberIds.length;
    const assigneeId = project.teamMemberIds[assigneeIdx];
    const reporterId = project.leadMemberId;
    const id = `task-${i + 1}`;
    tasks.push({
      id,
      title: `${pick(TASK_VERBS, i)} ${pick(TASK_NOUNS, i + 3)}`,
      description: `Detailed work item in ${project.name}. Tracks scope, acceptance criteria, and verification steps for the implementing team.`,
      status: pick(TASK_STATUSES, i),
      priority: pick(PRIORITIES, i),
      projectId: project.id,
      assigneeId,
      reporterId,
      dueDate: dateNDaysAgo(60 - (i % 90)),
      subtaskIds: [],
      commentIds: [],
    });
    const m = members.find((mm) => mm.id === assigneeId);
    if (m) m.taskIds.push(id);
  }
  // wire a few subtasks (every 7th task is a subtask of (i-1))
  for (let i = 0; i < 200; i++) {
    if (i > 0 && i % 7 === 0) {
      tasks[i - 1].subtaskIds.push(tasks[i].id);
    }
  }
  return tasks;
}

function buildComments(tasks: Task[], members: TeamMember[]): Comment[] {
  const comments: Comment[] = [];
  for (let i = 0; i < 500; i++) {
    const taskIdx = i % 200;
    const task = tasks[taskIdx];
    const authorId = `member-${(i % 40) + 1}`;
    const id = `comment-${i + 1}`;
    const replyToId = i > 0 && i % 5 === 0 ? `comment-${i}` : null;
    comments.push({
      id,
      taskId: task.id,
      authorId,
      body: pick(COMMENT_BODIES, i),
      createdAt: timestampNDaysAgo(60 - (i % 60), 9 + (i % 8)),
      replyToId,
    });
    task.commentIds.push(id);
  }
  return comments;
}

function buildIncidents(projects: Project[], tasks: Task[], members: TeamMember[]): Incident[] {
  const incidents: Incident[] = [];
  for (let i = 0; i < 50; i++) {
    const id = `incident-${i + 1}`;
    const affected = [`project-${(i % 10) + 1}`];
    const related = [`task-${((i * 3) % 200) + 1}`, `task-${((i * 3 + 1) % 200) + 1}`];
    incidents.push({
      id,
      title: `${pick(INCIDENT_TITLES, i)} (#${i + 1})`,
      severity: pick(INCIDENT_SEVERITIES, i),
      status: pick(INCIDENT_STATUSES, i),
      reportedByMemberId: `member-${(i % 40) + 1}`,
      affectedProjectIds: affected,
      relatedTaskIds: related,
      logIds: [],
    });
  }
  return incidents;
}

function buildIncidentLogs(incidents: Incident[], members: TeamMember[]): IncidentLog[] {
  const logs: IncidentLog[] = [];
  let counter = 1;
  for (const incident of incidents) {
    const n = 4 + (counter % 4); // 4–7 logs each → ~275 total
    for (let k = 0; k < n; k++) {
      const id = `log-${counter}`;
      logs.push({
        id,
        incidentId: incident.id,
        timestamp: timestampNDaysAgo(30 - (counter % 30), 8 + (k % 10)),
        message: pick([
          "Paged on-call",
          "Identified failing region",
          "Rolled back deploy",
          "Engaged platform team",
          "Verified mitigation",
          "Postmortem scheduled",
        ], counter + k),
        authorMemberId: `member-${(counter % 40) + 1}`,
      });
      incident.logIds.push(id);
      counter++;
    }
  }
  return logs;
}

function buildOrders(clients: Client[], projects: Project[]): Order[] {
  const orders: Order[] = [];
  for (let i = 0; i < 100; i++) {
    const clientIdx = i % 5;
    const projectIdx = i % 10;
    orders.push({
      id: `order-${i + 1}`,
      clientId: clients[clientIdx].id,
      projectId: projects[projectIdx].id,
      amount: 5000 + (i % 20) * 1250,
      status: pick(ORDER_STATUSES, i),
      orderDate: dateNDaysAgo(180 - i),
      lineItems: [
        { description: "Engineering services", qty: 40 + (i % 10), unit: 175 },
        { description: "Platform license", qty: 1, unit: 2500 + (i % 5) * 500 },
      ],
    });
  }
  return orders;
}

// ──────────────────────── Mutable store ────────────────────────

export interface FixtureStore {
  clients: Client[];
  contacts: Contact[];
  departments: Department[];
  members: TeamMember[];
  projects: Project[];
  tasks: Task[];
  comments: Comment[];
  incidents: Incident[];
  incidentLogs: IncidentLog[];
  orders: Order[];
  // counters for created entities
  nextTaskId: number;
  nextCommentId: number;
}

export function buildFixture(): FixtureStore {
  const clients = buildClients();
  const contacts = buildContacts(clients);
  const departments = buildDepartments();
  const members = buildTeamMembers(departments);
  const projects = buildProjects(clients, members);
  const tasks = buildTasks(projects, members);
  const comments = buildComments(tasks, members);
  const incidents = buildIncidents(projects, tasks, members);
  const incidentLogs = buildIncidentLogs(incidents, members);
  const orders = buildOrders(clients, projects);

  return {
    clients,
    contacts,
    departments,
    members,
    projects,
    tasks,
    comments,
    incidents,
    incidentLogs,
    orders,
    nextTaskId: tasks.length + 1,
    nextCommentId: comments.length + 1,
  };
}
