import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { ShipmentsService } from './shipments.service';
import { ShipmentStatus } from '../models/shipment.model';

@Component({
  selector: 'app-shipments-list-page',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatTableModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './shipments-list.page.html',
  styleUrl: './shipments-list.page.scss',
})
export class ShipmentsListPage {
  private readonly shipments = inject(ShipmentsService);
  private readonly route = inject(ActivatedRoute);

  readonly items = this.shipments.items;
  readonly columns = ['awb', 'route', 'status', 'version'];
  readonly lookupAwb = signal('');
  readonly lookupError = signal<string | null>(null);
  readonly createdAwb = this.route.snapshot.queryParamMap.get('created');

  chipClass(status: ShipmentStatus): string {
    return `status-${status.toLowerCase()}`;
  }

  lookup(): void {
    const awb = this.lookupAwb().trim();
    if (!awb) {
      return;
    }
    this.lookupError.set(null);
    this.shipments.getByAwb(awb).subscribe({
      error: () => this.lookupError.set(`No shipment found for ${awb}`),
    });
  }
}
