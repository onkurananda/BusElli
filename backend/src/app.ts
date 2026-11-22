import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';

export async function buildApp({ env }: { env: Env }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Routes registered here in subsequent milestones
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return app;
}
