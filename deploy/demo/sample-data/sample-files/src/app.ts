import { createServer } from './utils';
import config from './config.json';

const app = createServer({
  port: config.server.port,
  cors: config.server.cors,
  rateLimit: { windowMs: 60_000, max: 100 },
});

app.get('/metrics', async (req, res) => {
  const metrics = await req.db.query('SELECT * FROM metrics WHERE recorded_at > ?', [
    Date.now() - config.dashboard.refreshInterval,
  ]);
  res.json({ data: metrics, timestamp: new Date().toISOString() });
});

app.listen(() => {
  console.log(`Analytics API running on port ${config.server.port}`);
});
