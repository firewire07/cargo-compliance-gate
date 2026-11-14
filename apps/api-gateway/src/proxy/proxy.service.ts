import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  logLine,
  resolveCorrelationId,
} from '@cargo-compliance-gate/contracts';
import type { GatewayEnv } from '../config/env';

const SHIPMENT_PREFIXES = ['/shipments', '/holds', '/audit'];
const SCREENING_PREFIXES = ['/screenings'];

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly config: ConfigService<GatewayEnv, true>) {}

  isProxied(path: string): boolean {
    return this.targetBase(path) !== null;
  }

  targetBase(path: string): string | null {
    if (SHIPMENT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return this.config.get('SHIPMENT_SVC_URL', { infer: true });
    }
    if (SCREENING_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return this.config.get('SCREENING_SVC_URL', { infer: true });
    }
    return null;
  }

  async forward(req: Request, res: Response): Promise<void> {
    const base = this.targetBase(req.path);
    if (!base) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    const url = `${base}${req.path}${query}`;
    const headers = this.forwardHeaders(req);
    // The auth guard sets this; resolve again so a direct call can't skip it.
    const correlationId = resolveCorrelationId(headers[CORRELATION_ID_HEADER]);
    headers[CORRELATION_ID_HEADER] = correlationId;
    // Echo it so clients (and curl users) can quote it when reporting a problem.
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    const started = Date.now();
    const method = (req.method || 'GET').toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);
    let body: string | undefined;
    if (hasBody && req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        body = String(req.body);
      } else if (Object.keys(req.body).length > 0 || method !== 'GET') {
        body = JSON.stringify(req.body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      }
    }

    const upstream = await fetch(url, { method, headers, body });
    this.logger.log(
      logLine('proxy.request', {
        correlationId,
        method,
        path: req.path,
        status: upstream.status,
        ms: Date.now() - started,
        userId: headers['x-user-id'],
      }),
    );
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  }

  private forwardHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    const names = [
      'content-type',
      'accept',
      'x-user-id',
      'x-roles',
      'x-correlation-id',
      'idempotency-key',
    ];
    for (const name of names) {
      const value = req.headers[name];
      if (typeof value === 'string' && value.length > 0) {
        headers[name] = value;
      }
    }
    if (typeof req.headers['idempotency-key'] === 'string') {
      headers['Idempotency-Key'] = req.headers['idempotency-key'];
    }
    return headers;
  }
}
