import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { Hold, HoldPhase, holdPhase } from '../models/hold.model';
import { formatAge } from '../shared/format-age';
import { HoldsService } from './holds.service';

@Component({
  selector: 'app-holds-queue-page',
  imports: [RouterLink, MatCardModule, MatTableModule, MatChipsModule, MatButtonModule],
  templateUrl: './holds-queue.page.html',
  styleUrl: './holds-queue.page.scss',
})
export class HoldsQueuePage implements OnInit, OnDestroy {
  private readonly holds = inject(HoldsService);
  private liveSub?: Subscription;

  readonly items = this.holds.items;
  readonly columns = ['awb', 'reasons', 'age', 'status', 'open'];

  ngOnInit(): void {
    this.liveSub = this.holds.connectLive().subscribe();
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
  }

  phase(hold: Hold): HoldPhase {
    return holdPhase(hold);
  }

  age(hold: Hold): string {
    return formatAge(hold.createdAt);
  }

  reasons(hold: Hold): string[] {
    return Array.isArray(hold.reasons) ? hold.reasons : [];
  }

  chipClass(value: string): string {
    return `status-${value.toLowerCase().replace(/_/g, '-')}`;
  }
}
