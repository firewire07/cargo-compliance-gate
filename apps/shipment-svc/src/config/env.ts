import { z } from 'zod';

export const shipmentEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  KAFKA_BROKERS: z.string().min(1).default('127.0.0.1:9094'),
  HOLD_TIMEOUT_SECONDS: z.coerce.number().positive().default(30),
  HOLD_SWEEP_INTERVAL_MS: z.coerce.number().positive().default(2000),
  PORT: z.coerce.number().int().positive().default(3101),
  HOST: z.string().min(1).default('127.0.0.1'),
});

export type ShipmentEnv = z.infer<typeof shipmentEnvSchema>;

export function validateShipmentEnv(env: Record<string, unknown>): ShipmentEnv {
  const result = shipmentEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid shipment-svc configuration: ${details}`);
  }
  return result.data;
}

export function kafkaBrokers(raw: string): string[] {
  return raw
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}
