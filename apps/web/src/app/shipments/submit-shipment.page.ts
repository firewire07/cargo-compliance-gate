import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HttpErrorResponse } from '@angular/common/http';
import { CreateShipmentRequest } from '../models/shipment.model';
import { ShipmentsService } from './shipments.service';

@Component({
  selector: 'app-submit-shipment-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './submit-shipment.page.html',
  styleUrl: './submit-shipment.page.scss',
})
export class SubmitShipmentPage {
  private readonly fb = inject(FormBuilder);
  private readonly shipments = inject(ShipmentsService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    awb: ['', [Validators.required, Validators.pattern(/^[0-9]{3}-?[0-9]{8}$/)]],
    origin: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{2,3}$/)]],
    destination: [
      '',
      [Validators.required, Validators.pattern(/^[A-Za-z]{2,3}$/)],
    ],
    pieces: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    weight: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(0),
    ]),
    goodsDescription: ['', Validators.required],
    hsCode: [''],
    unNumber: [''],
    routing: ['', Validators.required],
    shipper: this.fb.nonNullable.group({
      name: ['', Validators.required],
      country: [
        '',
        [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
      ],
    }),
    consignee: this.fb.nonNullable.group({
      name: ['', Validators.required],
      country: [
        '',
        [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
      ],
    }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.shipments.create(this.toRequest()).subscribe({
      next: (shipment) => {
        this.submitting.set(false);
        this.form.reset();
        void this.router.navigate(['/shipments'], {
          queryParams: { created: shipment.awb },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorMessage.set(
          err.error?.message ?? err.message ?? 'Could not create the shipment',
        );
      },
    });
  }

  private toRequest(): CreateShipmentRequest {
    const value = this.form.getRawValue();
    return {
      awb: value.awb,
      origin: value.origin.toUpperCase(),
      destination: value.destination.toUpperCase(),
      pieces: Number(value.pieces),
      weight: Number(value.weight),
      goodsDescription: value.goodsDescription,
      hsCode: value.hsCode || undefined,
      unNumber: value.unNumber || undefined,
      routing: value.routing,
      shipper: {
        name: value.shipper.name,
        country: value.shipper.country.toUpperCase(),
      },
      consignee: {
        name: value.consignee.name,
        country: value.consignee.country.toUpperCase(),
      },
    };
  }
}
