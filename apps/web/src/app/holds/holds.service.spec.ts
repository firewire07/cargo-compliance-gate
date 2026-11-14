import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Hold } from '../models/hold.model';
import { HoldsService } from './holds.service';

const hold: Hold = {
  id: 'h1',
  awb: '020-11111111',
  shipmentVersion: 1,
  reasons: ['SANCTIONS hit'],
  checklist: [],
  createdAt: '2026-11-14T01:00:00.000Z',
  shipmentStatus: 'HELD',
};

describe('HoldsService', () => {
  let service: HoldsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HoldsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('loads the hold queue from GET /api/holds', () => {
    let rows: Hold[] = [];
    service.list().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/holds');
    expect(req.request.method).toBe('GET');
    req.flush([hold]);
    expect(rows).toEqual([hold]);
    expect(service.items()[0].awb).toBe(hold.awb);
  });

  it('refreshes a hold when a live shipment.held event arrives', () => {
    service.applyEvent({ id: 'evt-1', type: 'shipment.held', awb: hold.awb });
    const req = http.expectOne(`/api/holds/${hold.awb}`);
    req.flush({ ...hold, shipmentStatus: 'HELD' });
    expect(service.items()[0].shipmentStatus).toBe('HELD');
  });

  it('ignores events that do not change holds', () => {
    service.applyEvent({ id: 'evt-2', type: 'shipment.cleared', awb: hold.awb });
    http.expectNone(`/api/holds/${hold.awb}`);
  });
});
