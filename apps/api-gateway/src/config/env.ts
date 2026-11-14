import { z } from 'zod';

export const gatewayEnvSchema = z
  .object({
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    JWT_EXPIRES_IN: z.string().min(1).default('2h'),
    GATEWAY_PORT: z.coerce.number().int().positive().optional(),
    PORT: z.coerce.number().int().positive().optional(),
    HOST: z.string().min(1).default('127.0.0.1'),
    SHIPMENT_SVC_URL: z.string().min(1).default('http://127.0.0.1:3101'),
    SCREENING_SVC_URL: z.string().min(1).default('http://127.0.0.1:3102'),
    KAFKA_BROKERS: z.string().min(1).default('127.0.0.1:9094'),
  })
  .transform((value) => ({
    ...value,
    GATEWAY_PORT: value.GATEWAY_PORT ?? value.PORT ?? 3100,
  }));

export type GatewayEnv = z.infer<typeof gatewayEnvSchema>;

export function validateGatewayEnv(env: Record<string, unknown>): GatewayEnv {
  const result = gatewayEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid api-gateway configuration: ${details}`);
  }
  return result.data;
}

export function kafkaBrokers(raw: string): string[] {
  return raw
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}
