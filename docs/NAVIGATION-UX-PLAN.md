# Navigation UX Plan: Infinite Scroll + Branching

## Concept

Replace the current "replace content on each prompt" behavior with an **append-below** model where each response creates a new section. Users scroll up to see previous states, click to navigate back, and can fork from any previous point to explore a different path.

## Key Research Findings

- **No existing product** combines AI conversation + visual dashboard output + infinite scroll with collapsible states + branching. This is genuinely novel.
- **tldraw Branching Chat** is the closest OSS reference — node-based canvas with visual connectors, but uses spatial layout not scroll.
- **LibreChat** has production-proven forking with three granularity levels and parent-child message relationships.
- **ChatGPT** already has hidden branching (edit a message → fork) but only shows it as tiny left/right arrows — no tree visualization.
- **Conversation Tree Architecture** (arxiv 2603.21278) formalizes the data model: each node = prompt + response, isolated context, context flows downstream.

## Data Model

```
ConversationTree {
  id: string
  rootNodeId: string
  activeNodeId: string        // currently focused node
  nodes: Map<string, Node>
}

Node {
  id: string
  parentId: string | null
  children: string[]          // child node IDs (branches)
  prompt: string
  promptDisplay: string       // short label for breadcrumb/sidebar
  response: string            // raw LLM response (HTML or text)
  componentSnapshot: {        // for collapsed thumbnail view
    type: 'components' | 'text'
    summary: string           // 1-line summary (e.g. "12 files, 3 dirs")
    componentTags: string[]   // which mcpui-* tags were rendered
  }
  timestamp: number
  collapsed: boolean
  branchLabel?: string        // user-assigned label for this branch
}
```

## Implementation Phases

### Phase 1: Append-Below (Replace → Scroll)

**Current behavior:** Each prompt replaces `dashboard-container` innerHTML.
**New behavior:** Each prompt appends a new section below the previous one.

```
┌─────────────────────────────────┐
│ [Section 1 - collapsed]         │  ← prompt summary + mini-preview
│  "What tools are available?"    │
│  12 tools across 2 categories   │
├─────────────────────────────────┤
│ [Section 2 - collapsed]         │  ← click to expand
│  "List files in /src"           │
│  8 files, 2.4 KB total          │
├─────────────────────────────────┤
│ [Section 3 - EXPANDED]          │  ← current, full dashboard
│  "Show me index.ts details"     │
│  ┌──────────┐ ┌──────────┐     │
│  │ mcpui-   │ │ mcpui-   │     │
│  │ card     │ │ table    │     │
│  └──────────┘ └──────────┘     │
└─────────────────────────────────┘
```

**Changes needed:**
- `app.js`: Instead of `container.innerHTML = ''`, create a new `<div class="mcpui-section-block">` and append it
- Auto-collapse previous section when new one arrives (Notion toggle style)
- Each section header: prompt text + summary + expand/collapse chevron
- Smooth scroll to new section on arrival
- Clicking a collapsed section expands it and scrolls to it
- Clicking a chat sidebar message scrolls to + expands corresponding section

### Phase 2: Collapse & Summary

**Collapsed view per section:**
```
┌─────────────────────────────────────────────┐
│ ▶  "List files in current directory"        │
│    📊 stat-bar + table  •  6 files, 3 dirs  │
└─────────────────────────────────────────────┘
```

**Expanded view:**
```
┌─────────────────────────────────────────────┐
│ ▼  "List files in current directory"    [×] │
│                                             │
│ ● 3 Files  ● 3 Directories  ● 1.02 KB      │
│ ┌─────────────────────────────────────────┐ │
│ │ Directory Listing                       │ │
│ │ NAME    TYPE     SIZE                   │ │
│ │ ...     ...      ...                    │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Component summary auto-generation:**
- Count mcpui-* tags rendered → "stat-bar + table"
- Extract key values from first stat-bar items → "6 files, 3 dirs"
- For text responses → first ~60 chars of text content

**Sticky header:** When scrolling through an expanded section, its header sticks to the top of the viewport so you always know which section you're in.

### Phase 3: Browser History Integration

**URL scheme:**
```
/                           → empty state
/c/{conversationId}         → conversation root (latest node)
/c/{conversationId}/{nodeId} → specific node in the tree
```

**pushState triggers:**
- New prompt submitted → push new node URL
- Click breadcrumb/sidebar to jump to previous node → push that node URL
- Switch branches → push target branch node URL

**popstate handler (back/forward):**
- Read nodeId from state
- Scroll to that section, expand it, collapse others
- Update breadcrumb trail

**State object:** `{ nodeId, scrollY }` — keep it small, full state lives in IndexedDB.

### Phase 4: Branching

**Fork trigger:** User scrolls up to a previous section, clicks "Ask from here" button on the section header. This:
1. Sets that node as the new "active parent"
2. Opens prompt input focused on continuing from that point
3. New response appends below that section (not at the bottom)
4. The branch indicator shows in breadcrumb and sidebar

**Visual representation of branches:**

Option A — **Inline branch indicator** (recommended for MVP):
```
┌─────────────────────────────────────────┐
│ ▶  "What tools are available?"          │
├─────────────────────────────────────────┤
│ ▶  "List files in /src"                 │
│    ├─ Branch A: "Show me index.ts"  ←── │  current path
│    └─ Branch B: "Show me package.json"  │  alternate
├─────────────────────────────────────────┤
│ ▼  "Show me index.ts" [expanded]        │
└─────────────────────────────────────────┘
```

Option B — **Sidebar tree view** (Phase 4b):
```
Conversation Tree
├── What tools are available?
├── List files in /src
│   ├── Show me index.ts        ← active
│   │   └── Read line 42
│   └── Show me package.json
│       └── Show dependencies
└── (new prompt)
```

Option C — **Canvas/map view** (future, inspired by tldraw):
A toggle to switch from scroll view to spatial canvas view where nodes are connected boxes you can drag and rearrange.

### Phase 5: Persistence (LocalStorage + IndexedDB)

**Storage strategy:**

| Data | Storage | Key |
|------|---------|-----|
| Active conversation ID | `localStorage` | `mcpui:activeConversation` |
| UI preferences (collapsed states) | `localStorage` | `mcpui:prefs` |
| Conversation tree (nodes, branches) | `IndexedDB` | `conversations` store |
| Node response content (HTML) | `IndexedDB` | `nodeContent` store |
| Component snapshots for thumbnails | `IndexedDB` | `snapshots` store |

**Library:** `idb-keyval` for simple get/set, or `Dexie.js` if we need queries.

**On page load:**
1. Read active conversation from localStorage
2. Load conversation tree from IndexedDB
3. Render collapsed sections for all nodes
4. Expand the last node (or the node from URL)
5. Restore scroll position

**On new response:**
1. Create node in tree
2. Persist to IndexedDB
3. pushState with new URL

## Implementation Priority

| Phase | Effort | Impact | Dependencies |
|-------|--------|--------|-------------|
| 1. Append-below | Medium | High | None |
| 2. Collapse & summary | Medium | High | Phase 1 |
| 3. Browser history | Low | Medium | Phase 1 |
| 4a. Branching (inline) | High | High | Phase 1-2 |
| 4b. Sidebar tree | Medium | Medium | Phase 4a |
| 5. Persistence | Medium | High | Phase 1 |

**Recommended order:** Phase 1 → Phase 2 → Phase 5 → Phase 3 → Phase 4a → Phase 4b

## Key Design Decisions

1. **Scroll vs Canvas:** Start with scroll (familiar, works on mobile, simpler). Canvas can be a future "map mode" toggle.

2. **Auto-collapse strategy:** Collapse all sections except the last 2. When a new section arrives, collapse the 3rd-from-bottom. User can manually expand any section.

3. **Branch context:** When forking from a previous node, the LLM receives the conversation history up to that node (not the full tree). This matches the Conversation Tree Architecture paper's recommendation.

4. **Section identity:** Each section is a DOM element with `data-node-id`. Chat sidebar messages link to sections via shared node ID.

5. **Virtualization:** Not needed for MVP (most conversations < 50 sections). Add react-virtual or manual IntersectionObserver lazy-rendering if performance degrades past 100 sections.

## References

- [tldraw Branching Chat Template](https://github.com/tldraw/branching-chat-template)
- [LibreChat Forking](https://www.librechat.ai/docs/features/fork)
- [Conversation Tree Architecture](https://arxiv.org/abs/2603.21278)
- [Accordion Pattern (UX Patterns for Developers)](https://uxpatterns.dev/patterns/content-management/accordion)
- [History API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
- [Excalidraw Persistence Architecture](https://deepwiki.com/zsviczian/excalidraw/7.3-json-serialization)
