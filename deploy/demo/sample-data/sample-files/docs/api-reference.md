# API Reference

## Authentication

All endpoints require a Bearer token in the `Authorization` header.

## Endpoints

### GET /api/metrics
Returns current metric values with trend indicators.

**Response:**
```json
{
  "data": [{ "name": "page_views", "value": 14523, "trend": "up" }],
  "timestamp": "2026-04-10T12:00:00Z"
}
```

### GET /api/metrics/:name/history?range=24h
Returns time-series data for a specific metric.

### POST /api/alerts
Create a new alert rule.

**Body:**
```json
{
  "metric": "error_rate",
  "operator": "gt",
  "threshold": 1.0,
  "channels": ["slack", "email"]
}
```

### GET /api/users
List all users with roles and status. Supports `?role=` and `?status=` filters.
