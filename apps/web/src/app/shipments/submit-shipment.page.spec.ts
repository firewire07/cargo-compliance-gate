import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SubmitShipmentPage } from './submit-shipment.page';

describe('SubmitShipmentPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitShipmentPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  function fillValid(component: SubmitShipmentPage): void {
    component.form.setValue({
      awb: '020-55555555',
      origin: 'KUL',
      destination: 'AMS',
      pieces: 2,
      weight: 15.5,
      goodsDescription: 'Electronic parts',
      hsCode: '8542.31',
      unNumber: '',
      routing: 'KUL-AMS',
      shipper: { name: 'Acme Forwarding', country: 'MY' },
      consignee: { name: 'Rotterdam Imports', country: 'NL' },
    });
  }

  it('is invalid until the required shipment fields are filled', async () => {
    const fixture = TestBed.createComponent(SubmitShipmentPage);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.form.valid).toBe(false);
    component.form.controls.awb.setValue('bad');
    expect(component.form.controls.awb.valid).toBe(false);

    fillValid(component);
    expect(component.form.valid).toBe(true);

    component.form.controls.unNumber.setValue('');
    component.form.controls.hsCode.setValue('');
    expect(component.form.valid).toBe(true);
  });
});
