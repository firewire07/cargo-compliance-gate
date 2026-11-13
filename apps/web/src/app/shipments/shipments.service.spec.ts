import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreateShipmentRequest, Shipment } from '../models/shipment.model';
import { ShipmentsService } from './shipments.service';

const body: CreateShipmentRequest = {
  awb: '020-55555555',
  origin: 'KUL',
  destination: 'AMS',
  pieces: 1,
  weight: 2,
  goodsDescription: 'Parts',
  routing: 'KUL-AMS',
  shipper: { name: 'Acme', country: 'MY' },
  consignee: { name: 'Imports', country: 'NL' },
};

const created: Shipment = {
  id: 's1',
  awb: body.awb,
  origin: body.origin,
  destination: body.destination,
  pieces: 1,
  weight: 2,
  goodsDescription: body.goodsDescription,
  routing: body.routing,
  status: 'SUBMITTED',
  version: 1,
};

describe('ShipmentsService', () => {
  let service: ShipmentsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ShipmentsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reuses the same Idempotency-Key when a submission is retried', () => {
    const firstKey = service.peekOrCreateIdempotencyKey();
    const retryKey = service.peekOrCreateIdempotencyKey();
    expect(retryKey).toBe(firstKey);

    let firstError = false;
    service.create(body).subscribe({ error: () => (firstError = true) });
    const failed = http.expectOne('/api/shipments');
    expect(failed.request.headers.get('Idempotency-Key')).toBe(firstKey);
    failed.flush('down', { status: 500, statusText: 'Server Error' });
    expect(firstError).toBe(true);

    service.create(body).subscribe();
    const retried = http.expectOne('/api/shipments');
    expect(retried.request.headers.get('Idempotency-Key')).toBe(firstKey);
    retried.flush(created);

    const nextSubmission = service.peekOrCreateIdempotencyKey();
    expect(nextSubmission).not.toBe(firstKey);
  });
});
