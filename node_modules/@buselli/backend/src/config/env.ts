import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),

  // PostgreSQL / PostGIS
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).default(20),

  // Redis
  REDIS_URL: z.string().url(),

  // Kafka
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_TELEMETRY_TOPIC: z.string().default('telemetry.raw'),
  KAFKA_CROWD_TOPIC: z.string().default('crowd.tags'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('24h'),

  // ETA settings
  TELEMETRY_STALE_SECONDS: z.coerce.number().int().default(120),
  CROWD_TAG_TTL_SECONDS: z.coerce.number().int().default(1200),
  BUS_CLUSTER_TTL_SECONDS: z.coerce.number().int().default(300),
  CONFIDENCE_DECAY_PER_SECOND: z.coerce.number().min(0).max(1).default(0.0017), // ~15% per 90s
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:\n', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}
