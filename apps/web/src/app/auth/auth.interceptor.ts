import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken();
  const headers =
    token && !req.headers.has('Authorization')
      ? req.headers.set('Authorization', `Bearer ${token}`)
      : req.headers;
  return next(req.clone({ headers, withCredentials: true }));
};
