import { z } from 'zod';

export const screeningEnvSchema = z.object({
  SCREENING_DATABASE_URL: z.string().min(1, 'SCREENING_DATABASE_URL is required'),
  KAFKA_BROKERS: z.string().min(1).default('127.0.0.1:9094'),
  SANCTIONS_MODE: z.enum(['name-only', 'contextual']).default('name-only'),
  SCREENING_SVC_PORT: z.coerce.number().int().positive().default(3102),
  HOST: z.string().min(1).default('127.0.0.1'),
  SCREENING_DATA_DIR: z.string().min(1).optional(),
});

export type ScreeningEnv = z.infer<typeof screeningEnvSchema>;

export function validateScreeningEnv(env: Record<string, unknown>): ScreeningEnv {
  const result = screeningEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid screening-svc configuration: ${details}`);
  }
  return result.data;
}

export function kafkaBrokers(raw: string): string[] {
  return raw
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}
