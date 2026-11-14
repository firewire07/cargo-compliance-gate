/**
 * T8 end-to-end flow against the api-gateway only (default http://127.0.0.1:3100).
 * Requires shipment-svc, screening-svc, api-gateway, and Docker Compose to be up.
 *
 *   npm run e2e
 */

const BASE = process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100';
const POLL_MS = 250;
const DECISION_TIMEOUT_MS = 30_000;

type LoginUser = { id: string; username: string; roles: string[] };

type Shipment = {
  id: string;
  awb: string;
  status: string;
  version: number;
};

type AuditEntry = {
  seq: number;
  type: string;
  awb: string;
  actor: string;
  hash: string;
  prevHash: string;
};

const CHECKLIST = {
  items: [
    { id: 'identity-verified', done: true },
    { id: 'documents-complete', done: true },
    { id: 'sanctions-rationale', done: true, note: 'T8 e2e' },
    { id: 'goods-consistent', done: true },
  ],
};

function uniqueAwb(): string {
  const n = (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)))
    .toString()
    .slice(-8);
  return `020-${n}`;
}

function shipmentBody(awb: string, consignee: string, extras: Record<string, unknown> = {}) {
  return {
    awb,
    origin: 'KUL',
    destination: 'AMS',
    pieces: 2,
    weight: 15.5,
    goodsDescription: 'Electronic parts',
    hsCode: '8542.31',
    routing: 'KUL-AMS',
    shipper: { name: 'Acme Forwarding', country: 'MY' },
    consignee: { name: consignee, country: 'NL' },
    ...extras,
  };
}

async function request(
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    idempotencyKey?: string;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

async function login(username: string, password: string): Promise<string> {
  const res = await request('POST', '/auth/login', {
    body: { username, password },
  });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  const token = (res.body as { accessToken?: string }).accessToken;
  expect(token).toEqual(expect.any(String));
  return token!;
}

async function getShipment(token: string, awb: string): Promise<Shipment> {
  const res = await request('GET', `/shipments/${awb}`, { token });
  expect(res.status).toBe(200);
  return res.body as Shipment;
}

async function waitForStatus(
  token: string,
  awb: string,
  expected: string,
  timeoutMs = DECISION_TIMEOUT_MS,
): Promise<Shipment> {
  const started = Date.now();
  let last = 'UNKNOWN';
  while (Date.now() - started < timeoutMs) {
    const res = await request('GET', `/shipments/${awb}`, { token });
    if (res.status === 200) {
      const shipment = res.body as Shipment;
      last = shipment.status;
      if (shipment.status === expected) {
        return shipment;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${awb} to become ${expected} (last status: ${last})`,
  );
}

type StreamHandle = {
  events: Array<{ type: string; awb: string }>;
  close: () => void;
};

async function openStream(token: string): Promise<StreamHandle> {
  const issued = await request('POST', '/auth/stream-token', { token });
  expect(issued.status).toBeGreaterThanOrEqual(200);
  expect(issued.status).toBeLessThan(300);
  const streamToken = (issued.body as { token: string }).token;
  const abort = new AbortController();
  const events: Array<{ type: string; awb: string }> = [];
  const res = await fetch(`${BASE}/stream?token=${encodeURIComponent(streamToken)}`, {
    headers: { Accept: 'text/event-stream' },
    signal: abort.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const block of parts) {
          let type = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
              type = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += line.slice(5).trim();
            }
          }
          if (!data) {
            continue;
          }
          try {
            const parsed = JSON.parse(data) as { type?: string; awb?: string };
            events.push({ type: parsed.type ?? type, awb: parsed.awb ?? '' });
          } catch {
            // ignore malformed frames
          }
        }
      }
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'AbortError') {
        // connection closed by test teardown
      }
    }
  })();
  void pump;
  return {
    events,
    close: () => {
      abort.abort();
    },
  };
}

describe('T8 gateway end-to-end flow', () => {
  const cleanAwb = uniqueAwb();
  const heldAwb = uniqueAwb();
  const idemAwb = uniqueAwb();
  let operator: string;
  let analystA: string;
  let analystB: string;
  let stream: StreamHandle | undefined;

  beforeAll(async () => {
    const health = await request('GET', '/health');
    if (health.status !== 200) {
      throw new Error(
        `api-gateway is not reachable at ${BASE} (HTTP ${health.status}). Start shipment-svc, screening-svc and api-gateway, then re-run npm run e2e.`,
      );
    }
    operator = await login('operator', 'operator-demo');
    analystA = await login('analyst-a', 'analyst-a-demo');
    analystB = await login('analyst-b', 'analyst-b-demo');
    stream = await openStream(operator);
  });

  afterAll(() => {
    stream?.close();
  });

  it('clears a clean shipment and holds a sanctioned consignee', async () => {
    const clean = await request('POST', '/shipments', {
      token: operator,
      body: shipmentBody(cleanAwb, 'Rotterdam Imports'),
    });
    expect(clean.status).toBe(202);
    expect((clean.body as Shipment).status).toBe('CHECKING');
    await waitForStatus(operator, cleanAwb, 'CLEARED');

    const held = await request('POST', '/shipments', {
      token: operator,
      body: shipmentBody(heldAwb, 'Viktor Petrov Trading'),
    });
    expect(held.status).toBe(202);
    const decided = await waitForStatus(operator, heldAwb, 'HELD');
    expect(decided.status).toBe('HELD');
  });

  it('enforces maker-checker release and leaves a verifiable audit chain', async () => {
    const asOperator = await request('POST', `/holds/${heldAwb}/release-requests`, {
      token: operator,
    });
    expect(asOperator.status).toBe(403);

    const checklist = await request('PATCH', `/holds/${heldAwb}/checklist`, {
      token: analystA,
      body: CHECKLIST,
    });
    expect(checklist.status).toBe(200);

    const requested = await request('POST', `/holds/${heldAwb}/release-requests`, {
      token: analystA,
    });
    expect(requested.status).toBeGreaterThanOrEqual(200);
    expect(requested.status).toBeLessThan(300);

    const selfApprove = await request('POST', `/holds/${heldAwb}/release-approvals`, {
      token: analystA,
    });
    expect(selfApprove.status).toBe(403);

    const approved = await request('POST', `/holds/${heldAwb}/release-approvals`, {
      token: analystB,
    });
    expect(approved.status).toBeGreaterThanOrEqual(200);
    expect(approved.status).toBeLessThan(300);

    const released = await waitForStatus(operator, heldAwb, 'RELEASED');
    expect(released.status).toBe('RELEASED');

    const audit = await request('GET', `/audit/${heldAwb}`, { token: operator });
    expect(audit.status).toBe(200);
    const entries = audit.body as AuditEntry[];
    const types = entries.map((row) => row.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'shipment.submitted',
        'shipment.held',
        'hold.checklist.updated',
        'hold.release.requested',
        'hold.release.approved',
        'shipment.released',
      ]),
    );
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].seq).toBeGreaterThan(entries[i - 1].seq);
    }

    const verify = await request('GET', '/audit/verify', { token: operator });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual(expect.objectContaining({ ok: true }));
  });

  it('replays the same Idempotency-Key and rejects a different body with 409', async () => {
    const key = `e2e-${idemAwb}`;
    const body = shipmentBody(idemAwb, 'Rotterdam Imports');
    const first = await request('POST', '/shipments', {
      token: operator,
      body,
      idempotencyKey: key,
    });
    expect(first.status).toBe(202);
    const firstShipment = first.body as Shipment;

    const replay = await request('POST', '/shipments', {
      token: operator,
      body,
      idempotencyKey: key,
    });
    expect(replay.status).toBe(202);
    expect((replay.body as Shipment).id).toBe(firstShipment.id);
    expect((replay.body as Shipment).awb).toBe(idemAwb);

    const conflict = await request('POST', '/shipments', {
      token: operator,
      body: { ...body, pieces: 9, awb: uniqueAwb() },
      idempotencyKey: key,
    });
    expect(conflict.status).toBe(409);

    const list = await request('GET', '/shipments', { token: operator });
    expect(list.status).toBe(200);
    const matches = (list.body as Shipment[]).filter((row) => row.awb === idemAwb);
    expect(matches).toHaveLength(1);
  });

  it('receives shipment status events on the SSE stream', async () => {
    expect(stream).toBeDefined();
    const started = Date.now();
    while (Date.now() - started < DECISION_TIMEOUT_MS) {
      const types = stream!.events.map((event) => `${event.awb}:${event.type}`);
      const sawClean =
        types.includes(`${cleanAwb}:shipment.submitted`) &&
        types.includes(`${cleanAwb}:shipment.cleared`);
      const sawHeld = types.includes(`${heldAwb}:shipment.held`);
      if (sawClean && sawHeld) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(
      `SSE did not receive expected status events. Saw: ${JSON.stringify(stream!.events)}`,
    );
  });
});
