import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { validateEnv } from './config/env.js';

const env = validateEnv();

async function main(): Promise<void> {
  const app: FastifyInstance = await buildApp({ env });

  await app.listen({
    port: env.PORT,
    host: '0.0.0.0',
  });

  logger.info({ port: env.PORT }, 'BusElli backend started');
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
