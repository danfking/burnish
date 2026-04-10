# Architecture Overview

## System Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Dashboard   │────▶│  API Server   │────▶│  PostgreSQL  │
│  (React SPA) │     │  (Node/Hono)  │     │  + TimescaleDB│
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │  Event Queue  │
                    │  (Redis)      │
                    └──────────────┘
```

## Data Flow

1. Events arrive via REST API or WebSocket
2. Events are validated, enriched with metadata, and queued in Redis
3. Workers consume events and write to TimescaleDB hypertables
4. Dashboard queries aggregated views with automatic rollups
5. Alerts evaluate threshold rules every 10 seconds

## Key Design Decisions

- **TimescaleDB** over plain PostgreSQL for automatic time-based partitioning
- **Redis Streams** for event buffering — handles 50k events/sec burst traffic
- **Server-Sent Events** for real-time dashboard updates (simpler than WebSocket for unidirectional data)
