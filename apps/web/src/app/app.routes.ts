import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { LoginPage } from './auth/login.page';
import { ShipmentsListPage } from './shipments/shipments-list.page';
import { SubmitShipmentPage } from './shipments/submit-shipment.page';

export const appRoutes: Route[] = [
  { path: 'login', component: LoginPage },
  {
    path: 'shipments/new',
    component: SubmitShipmentPage,
    canActivate: [authGuard],
  },
  {
    path: 'shipments',
    component: ShipmentsListPage,
    canActivate: [authGuard],
  },
  { path: '', pathMatch: 'full', redirectTo: 'shipments' },
  { path: '**', redirectTo: 'shipments' },
];
