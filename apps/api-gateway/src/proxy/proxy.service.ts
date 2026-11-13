import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

const SHIPMENT_PREFIXES = ['/shipments', '/holds', '/audit'];
const SCREENING_PREFIXES = ['/screenings'];

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  isProxied(path: string): boolean {
    return this.targetBase(path) !== null;
  }

  targetBase(path: string): string | null {
    if (SHIPMENT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return process.env.SHIPMENT_SVC_URL || 'http://127.0.0.1:3101';
    }
    if (SCREENING_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return process.env.SCREENING_SVC_URL || 'http://127.0.0.1:3102';
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
