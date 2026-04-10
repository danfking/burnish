import { randomUUID } from 'crypto';

export function createServer(opts: { port: number; cors: string[]; rateLimit: { windowMs: number; max: number } }) {
  // Server factory — simplified for demo
  return {
    get: (path: string, handler: Function) => {},
    post: (path: string, handler: Function) => {},
    listen: (cb: () => void) => cb(),
  };
}

export function formatMetric(value: number, unit: string): string {
  if (unit === 'bytes') return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (unit === 'ms') return `${value.toFixed(0)}ms`;
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return `${value} ${unit}`;
}

export function generateRequestId(): string {
  return `req_${randomUUID().slice(0, 8)}`;
}
