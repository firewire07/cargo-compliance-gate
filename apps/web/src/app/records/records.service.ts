import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuditEntry, AuditVerifyResult } from '../models/audit.model';
import { ScreeningResult } from '../models/screening.model';

@Injectable({ providedIn: 'root' })
export class RecordsService {
  private readonly http = inject(HttpClient);

  getScreenings(awb: string): Observable<ScreeningResult[]> {
    return this.http
      .get<ScreeningResult[]>(`/api/screenings/${encodeURIComponent(awb)}`)
      .pipe(catchError(() => of([])));
  }

  getAudit(awb: string): Observable<AuditEntry[]> {
    return this.http
      .get<AuditEntry[]>(`/api/audit/${encodeURIComponent(awb)}`)
      .pipe(catchError(() => of([])));
  }

  verifyAudit(): Observable<AuditVerifyResult | null> {
    return this.http
      .get<AuditVerifyResult>('/api/audit/verify')
      .pipe(catchError(() => of(null)));
  }
}
