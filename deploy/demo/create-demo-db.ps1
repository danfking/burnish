# create-demo-db.ps1 — Creates the SQLite demo database for Burnish demo deployment
# Requires: sqlite3 CLI (or Python with sqlite3 module as fallback)

param(
    [string]$OutputPath = "$PSScriptRoot/sample-data/demo.db"
)

$ErrorActionPreference = "Stop"

# Remove existing DB if present
if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Force
}

# Ensure parent directory exists
$parentDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

# Use Python's sqlite3 module (more portable than sqlite3 CLI on Windows)
$sql = @"
import sqlite3, os

db_path = os.environ.get('DB_PATH', r'$OutputPath')
conn = sqlite3.connect(db_path)
c = conn.cursor()

# --- products table ---
c.execute('''CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL,
    status TEXT NOT NULL
)''')

products = [
    ('Wireless Keyboard', 'Electronics', 49.99, 150, 'active'),
    ('USB-C Hub 7-in-1', 'Electronics', 34.99, 230, 'active'),
    ('Ergonomic Mouse', 'Electronics', 29.99, 85, 'active'),
    ('Standing Desk Mat', 'Furniture', 44.99, 60, 'active'),
    ('Monitor Light Bar', 'Electronics', 59.99, 0, 'out_of_stock'),
    ('Mesh Office Chair', 'Furniture', 299.99, 25, 'active'),
    ('Desk Organizer Set', 'Accessories', 19.99, 340, 'active'),
    ('Webcam HD 1080p', 'Electronics', 79.99, 12, 'low_stock'),
    ('Noise-Cancel Headphones', 'Audio', 149.99, 45, 'active'),
    ('Portable SSD 1TB', 'Storage', 89.99, 110, 'active'),
    ('Mechanical Keyboard', 'Electronics', 129.99, 35, 'active'),
    ('Cable Management Kit', 'Accessories', 14.99, 500, 'active'),
    ('Laptop Stand', 'Furniture', 39.99, 75, 'active'),
    ('Bluetooth Speaker', 'Audio', 59.99, 0, 'discontinued'),
    ('Desk Lamp LED', 'Furniture', 34.99, 90, 'active'),
    ('Screen Protector Pack', 'Accessories', 9.99, 1200, 'active'),
    ('Thunderbolt Dock', 'Electronics', 199.99, 8, 'low_stock'),
    ('Whiteboard 48x36', 'Office', 89.99, 20, 'active'),
    ('Ergonomic Wrist Rest', 'Accessories', 24.99, 180, 'active'),
    ('USB Microphone', 'Audio', 69.99, 55, 'active'),
]
c.executemany('INSERT INTO products (name, category, price, stock, status) VALUES (?, ?, ?, ?, ?)', products)

# --- orders table ---
c.execute('''CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    total REAL NOT NULL,
    order_date TEXT NOT NULL,
    status TEXT NOT NULL
)''')

orders = [
    ('Alice Chen', 'Wireless Keyboard', 2, 99.98, '2026-04-01', 'shipped'),
    ('Bob Martinez', 'USB-C Hub 7-in-1', 1, 34.99, '2026-04-01', 'delivered'),
    ('Carol Williams', 'Mesh Office Chair', 1, 299.99, '2026-04-02', 'shipped'),
    ('David Kim', 'Portable SSD 1TB', 3, 269.97, '2026-04-02', 'processing'),
    ('Eva Singh', 'Monitor Light Bar', 1, 59.99, '2026-04-03', 'cancelled'),
    ('Frank Osei', 'Noise-Cancel Headphones', 2, 299.98, '2026-04-03', 'shipped'),
    ('Grace Tanaka', 'Desk Organizer Set', 4, 79.96, '2026-04-03', 'delivered'),
    ('Henry Novak', 'Mechanical Keyboard', 1, 129.99, '2026-04-04', 'shipped'),
    ('Alice Chen', 'Laptop Stand', 1, 39.99, '2026-04-04', 'delivered'),
    ('Bob Martinez', 'Thunderbolt Dock', 1, 199.99, '2026-04-05', 'processing'),
    ('Carol Williams', 'Ergonomic Mouse', 3, 89.97, '2026-04-05', 'shipped'),
    ('David Kim', 'Cable Management Kit', 2, 29.98, '2026-04-05', 'delivered'),
    ('Eva Singh', 'Webcam HD 1080p', 1, 79.99, '2026-04-06', 'shipped'),
    ('Frank Osei', 'Standing Desk Mat', 1, 44.99, '2026-04-06', 'processing'),
    ('Grace Tanaka', 'USB Microphone', 2, 139.98, '2026-04-06', 'shipped'),
    ('Henry Novak', 'Desk Lamp LED', 1, 34.99, '2026-04-07', 'delivered'),
    ('Alice Chen', 'Screen Protector Pack', 5, 49.95, '2026-04-07', 'shipped'),
    ('Bob Martinez', 'Bluetooth Speaker', 1, 59.99, '2026-04-07', 'cancelled'),
    ('Carol Williams', 'Whiteboard 48x36', 1, 89.99, '2026-04-08', 'processing'),
    ('David Kim', 'Ergonomic Wrist Rest', 2, 49.98, '2026-04-08', 'shipped'),
    ('Eva Singh', 'Wireless Keyboard', 1, 49.99, '2026-04-08', 'delivered'),
    ('Frank Osei', 'Portable SSD 1TB', 1, 89.99, '2026-04-09', 'shipped'),
    ('Grace Tanaka', 'Mesh Office Chair', 2, 599.98, '2026-04-09', 'processing'),
    ('Henry Novak', 'USB-C Hub 7-in-1', 3, 104.97, '2026-04-09', 'shipped'),
    ('Alice Chen', 'Noise-Cancel Headphones', 1, 149.99, '2026-04-10', 'processing'),
    ('Bob Martinez', 'Mechanical Keyboard', 1, 129.99, '2026-04-10', 'processing'),
    ('Carol Williams', 'Desk Organizer Set', 2, 39.98, '2026-04-10', 'processing'),
    ('David Kim', 'Monitor Light Bar', 1, 59.99, '2026-04-10', 'pending'),
    ('Eva Singh', 'Laptop Stand', 2, 79.98, '2026-04-10', 'pending'),
    ('Frank Osei', 'Webcam HD 1080p', 1, 79.99, '2026-04-10', 'pending'),
]
c.executemany('INSERT INTO orders (customer, product, quantity, total, order_date, status) VALUES (?, ?, ?, ?, ?, ?)', orders)

# --- metrics table ---
c.execute('''CREATE TABLE metrics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    recorded_at TEXT NOT NULL
)''')

metrics = [
    ('page_views', 14523, 'count', '2026-04-10T12:00:00Z'),
    ('unique_visitors', 3847, 'count', '2026-04-10T12:00:00Z'),
    ('avg_session_duration', 284, 'seconds', '2026-04-10T12:00:00Z'),
    ('bounce_rate', 34.2, 'percent', '2026-04-10T12:00:00Z'),
    ('conversion_rate', 3.8, 'percent', '2026-04-10T12:00:00Z'),
    ('revenue', 2847.50, 'usd', '2026-04-10T12:00:00Z'),
    ('avg_order_value', 94.92, 'usd', '2026-04-10T12:00:00Z'),
    ('cart_abandonment', 68.5, 'percent', '2026-04-10T12:00:00Z'),
    ('api_latency_p50', 42, 'ms', '2026-04-10T12:00:00Z'),
    ('api_latency_p99', 380, 'ms', '2026-04-10T12:00:00Z'),
    ('error_rate', 0.23, 'percent', '2026-04-10T12:00:00Z'),
    ('uptime', 99.97, 'percent', '2026-04-10T12:00:00Z'),
    ('cpu_utilization', 62.4, 'percent', '2026-04-10T12:00:00Z'),
    ('memory_usage', 4812, 'mb', '2026-04-10T12:00:00Z'),
    ('disk_io', 245, 'mbps', '2026-04-10T12:00:00Z'),
]
c.executemany('INSERT INTO metrics (name, value, unit, recorded_at) VALUES (?, ?, ?, ?)', metrics)

# --- deployments table ---
c.execute('''CREATE TABLE deployments (
    id INTEGER PRIMARY KEY,
    version TEXT NOT NULL,
    environment TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    deployed_at TEXT NOT NULL,
    deployed_by TEXT NOT NULL
)''')

deployments = [
    ('v2.4.1', 'production', 'success', 187, '2026-04-10T09:15:00Z', 'Alice Chen'),
    ('v2.4.1', 'staging', 'success', 142, '2026-04-10T08:30:00Z', 'Alice Chen'),
    ('v2.4.0', 'production', 'success', 195, '2026-04-07T14:00:00Z', 'Bob Martinez'),
    ('v2.4.0', 'staging', 'success', 138, '2026-04-07T11:20:00Z', 'Bob Martinez'),
    ('v2.3.9', 'production', 'rollback', 45, '2026-04-05T16:45:00Z', 'Carol Williams'),
    ('v2.3.9', 'staging', 'failed', 210, '2026-04-05T14:00:00Z', 'Carol Williams'),
    ('v2.3.8', 'production', 'success', 178, '2026-04-03T10:00:00Z', 'David Kim'),
    ('v2.3.8', 'staging', 'success', 155, '2026-04-03T08:15:00Z', 'David Kim'),
    ('v2.3.7', 'production', 'success', 162, '2026-04-01T11:30:00Z', 'Eva Singh'),
    ('v2.3.7', 'staging', 'success', 130, '2026-04-01T09:00:00Z', 'Eva Singh'),
]
c.executemany('INSERT INTO deployments (version, environment, status, duration_seconds, deployed_at, deployed_by) VALUES (?, ?, ?, ?, ?, ?)', deployments)

conn.commit()
conn.close()
print(f'Created demo database at {db_path}')
print(f'  products: 20 rows')
print(f'  orders: 30 rows')
print(f'  metrics: 15 rows')
print(f'  deployments: 10 rows')
"@

$env:DB_PATH = $OutputPath
python -c $sql

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create demo database"
    exit 1
}

Write-Host "Demo database created successfully at $OutputPath" -ForegroundColor Green
