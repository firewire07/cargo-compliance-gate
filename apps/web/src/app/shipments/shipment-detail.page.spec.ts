import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HoldsService } from '../holds/holds.service';
import { Hold } from '../models/hold.model';
import { SessionUser } from '../models/user.model';
import { RecordsService } from '../records/records.service';
import { Shipment } from '../models/shipment.model';
import { ShipmentDetailPage } from './shipment-detail.page';
import { ShipmentsService } from './shipments.service';

const awb = '020-11111111';

const shipment: Shipment = {
  id: 's1',
  awb,
  origin: 'KUL',
  destination: 'AMS',
  pieces: 2,
  weight: 15.5,
  goodsDescription: 'Electronic parts',
  routing: 'KUL-AMS',
  status: 'HELD',
  version: 1,
  parties: [
    { role: 'SHIPPER', name: 'Acme Forwarding', country: 'MY' },
    { role: 'CONSIGNEE', name: 'Viktor Petrov Trading', country: 'NL' },
  ],
};

const checklist = [
  { id: 'identity-verified', label: 'Identity reviewed', done: true },
  { id: 'documents-complete', label: 'Documents complete', done: true },
  { id: 'sanctions-rationale', label: 'Sanctions rationale', done: true },
  { id: 'goods-consistent', label: 'Goods consistent', done: true },
];

const requestedHold: Hold = {
  id: 'h1',
  awb,
  shipmentVersion: 1,
  reasons: ['SANCTIONS hit'],
  checklist,
  releaseRequestedBy: 'analyst-a',
  releaseRequestedAt: '2026-11-14T01:05:00.000Z',
  createdAt: '2026-11-14T01:00:00.000Z',
  shipmentStatus: 'HELD',
};

const operator: SessionUser = { id: 'operator', username: 'operator', roles: ['OPERATOR'] };
const analystA: SessionUser = { id: 'analyst-a', username: 'analyst-a', roles: ['ANALYST'] };
const analystB: SessionUser = { id: 'analyst-b', username: 'analyst-b', roles: ['ANALYST'] };

async function setup(
  user: SessionUser,
  hold: Hold,
  holdsOverrides: Partial<HoldsService> = {},
) {
  await TestBed.configureTestingModule({
    imports: [ShipmentDetailPage],
    providers: [
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ awb })) } },
      {
        provide: AuthService,
        useValue: {
          user: signal(user),
          isAnalyst: () => user.roles.includes('ANALYST'),
        },
      },
      {
        provide: ShipmentsService,
        useValue: {
          getByAwb: () => of(shipment),
          connectLive: () => EMPTY,
        },
      },
      {
        provide: HoldsService,
        useValue: {
          get: () => of(hold),
          updateChecklist: () => of(hold),
          requestRelease: () => of(hold),
          approveRelease: () => of({ holdId: hold.id }),
          rejectRelease: () => of(hold),
          ...holdsOverrides,
        },
      },
      {
        provide: RecordsService,
        useValue: {
          getScreenings: () => of([]),
          getAudit: () => of([
            {
              seq: 1,
              eventId: 'e1',
              type: 'shipment.submitted',
              awb,
              actor: 'system',
              ts: '2026-11-14T01:00:00.000Z',
              payloadHash: 'p',
              prevHash: '0',
              hash: 'h',
            },
          ]),
          verifyAudit: () => of({ ok: true, checked: 4 }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShipmentDetailPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('ShipmentDetailPage', () => {
  it('hides analyst actions from an operator but still shows the hold and audit', async () => {
    const fixture = await setup(operator, requestedHold);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(awb);
    expect(text).toContain('SANCTIONS hit');
    expect(text).toContain('shipment.submitted');
    expect(text).toContain('Chain verified');
    expect(text).not.toContain('Request release');
    expect(text).not.toContain('Approve release');
    expect(text).not.toContain('Save checklist');
  });

  it('tells the requesting analyst that they cannot approve their own request', async () => {
    const fixture = await setup(analystA, requestedHold);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('You requested this release. Another analyst must approve or reject it.');
    expect(text).not.toContain('Approve release');
  });

  it('lets a second analyst approve, and shows a 403 from the server if it is rejected', async () => {
    const fixture = await setup(analystB, requestedHold, {
      approveRelease: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              statusText: 'Forbidden',
              error: {
                message: 'Maker-checker: the requester cannot approve their own release',
              },
            }),
        ),
    } as Partial<HoldsService>);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Approve release');

    const approve = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Approve release'),
    );
    expect(approve).toBeTruthy();
    approve!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain(
      'Maker-checker: the requester cannot approve their own release',
    );
  });
});
