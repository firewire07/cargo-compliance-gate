import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, Subscription, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { HoldsService } from '../holds/holds.service';
import { AuditEntry, AuditVerifyResult } from '../models/audit.model';
import { ChecklistItem, Hold, checklistComplete, holdPhase } from '../models/hold.model';
import { ScreeningResult } from '../models/screening.model';
import { Shipment } from '../models/shipment.model';
import { RecordsService } from '../records/records.service';
import { apiErrorMessage } from '../shared/api-error';
import { formatAge } from '../shared/format-age';
import { ShipmentsService } from './shipments.service';

@Component({
  selector: 'app-shipment-detail-page',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './shipment-detail.page.html',
  styleUrl: './shipment-detail.page.scss',
})
export class ShipmentDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly shipments = inject(ShipmentsService);
  private readonly holds = inject(HoldsService);
  private readonly records = inject(RecordsService);
  private liveSub?: Subscription;
  private paramSub?: Subscription;

  readonly awb = signal('');
  readonly shipment = signal<Shipment | null>(null);
  readonly hold = signal<Hold | null>(null);
  readonly screenings = signal<ScreeningResult[]>([]);
  readonly audit = signal<AuditEntry[]>([]);
  readonly verify = signal<AuditVerifyResult | null>(null);
  readonly checklist = signal<ChecklistItem[]>([]);
  readonly rejectReason = signal('');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionNotice = signal<string | null>(null);
  readonly busy = signal(false);

  readonly user = this.auth.user;
  readonly isAnalyst = computed(() => this.auth.isAnalyst());
  readonly phase = computed(() => {
    const hold = this.hold();
    return hold ? holdPhase(hold) : null;
  });
  readonly isRequester = computed(() => {
    const hold = this.hold();
    const user = this.user();
    return !!hold?.releaseRequestedBy && hold.releaseRequestedBy === user?.id;
  });
  readonly canEditChecklist = computed(
    () => this.isAnalyst() && this.phase() !== 'RELEASED' && !!this.hold(),
  );
  readonly canRequestRelease = computed(
    () =>
      this.isAnalyst() &&
      this.phase() !== 'RELEASED' &&
      this.phase() !== 'RELEASE_REQUESTED' &&
      checklistComplete(this.checklist()),
  );
  readonly canDecideRelease = computed(
    () => this.isAnalyst() && this.phase() === 'RELEASE_REQUESTED' && !this.isRequester(),
  );
  readonly checklistReady = computed(() => checklistComplete(this.checklist()));

  ngOnInit(): void {
    this.paramSub = this.route.paramMap.subscribe((params) => {
      const awb = params.get('awb') ?? '';
      this.awb.set(awb);
      this.reload();
    });
    this.liveSub = this.shipments.connectLive().subscribe((event) => {
      if (event.awb === this.awb()) {
        this.reload(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.liveSub?.unsubscribe();
  }

  party(role: 'SHIPPER' | 'CONSIGNEE'): string {
    const shipment = this.shipment();
    const party = shipment?.parties?.find((item) => item.role === role);
    if (party) {
      return `${party.name} (${party.country})`;
    }
    return '—';
  }

  age(): string {
    return formatAge(this.hold()?.createdAt);
  }

  chipClass(value: string): string {
    return `status-${value.toLowerCase().replace(/_/g, '-')}`;
  }

  setItemDone(id: string, done: boolean): void {
    this.checklist.update((items) =>
      items.map((item) => (item.id === id ? { ...item, done } : item)),
    );
  }

  setItemNote(id: string, note: string): void {
    this.checklist.update((items) =>
      items.map((item) => (item.id === id ? { ...item, note } : item)),
    );
  }

  saveChecklist(): void {
    const awb = this.awb();
    this.runAction('Checklist saved.', () =>
      this.holds.updateChecklist(awb, this.checklist()),
    );
  }

  requestRelease(): void {
    const awb = this.awb();
    this.runAction('Release requested. Another analyst must approve it.', () =>
      this.holds.updateChecklist(awb, this.checklist()).pipe(
        switchMap(() => this.holds.requestRelease(awb)),
      ),
    );
  }

  approveRelease(): void {
    this.runAction('Release approved.', () => this.holds.approveRelease(this.awb()));
  }

  rejectRelease(): void {
    this.runAction('Release request rejected.', () =>
      this.holds.rejectRelease(this.awb(), this.rejectReason().trim() || undefined),
    );
  }

  private runAction(notice: string, fn: () => Observable<unknown>): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.actionNotice.set(null);
    fn().subscribe({
      next: () => {
        this.actionNotice.set(notice);
        this.busy.set(false);
        this.reload(false);
      },
      error: (err: unknown) => {
        this.actionError.set(apiErrorMessage(err, 'The server rejected that action.'));
        this.busy.set(false);
      },
    });
  }

  private reload(showLoading = true): void {
    const awb = this.awb();
    if (!awb) {
      return;
    }
    if (showLoading) {
      this.loading.set(true);
    }
    this.loadError.set(null);
    forkJoin({
      shipment: this.shipments.getByAwb(awb),
      hold: this.holds.get(awb).pipe(
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && err.status === 404) {
            return of(null);
          }
          throw err;
        }),
      ),
      screenings: this.records.getScreenings(awb),
      audit: this.records.getAudit(awb),
      verify: this.records.verifyAudit(),
    }).subscribe({
      next: ({ shipment, hold, screenings, audit, verify }) => {
        this.shipment.set(shipment);
        this.hold.set(hold);
        this.screenings.set(screenings);
        this.audit.set(audit);
        this.verify.set(verify);
        if (hold?.checklist) {
          this.checklist.set(hold.checklist.map((item) => ({ ...item })));
        } else {
          this.checklist.set([]);
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(apiErrorMessage(err, `Could not load shipment ${awb}.`));
        this.loading.set(false);
      },
    });
  }
}
