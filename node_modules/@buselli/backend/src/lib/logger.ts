// pino under NodeNext ESM: use the named pino export, not the default
import { pino } from 'pino';
import type { Logger } from 'pino';

const isProduction = process.env['NODE_ENV'] === 'production';

// exactOptionalPropertyTypes-safe: two separate calls, no undefined union for transport
export const logger: Logger = isProduction
  ? pino({ level: 'info' })
  : pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
