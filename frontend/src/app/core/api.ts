import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Wrapper fino sobre HttpClient para no repetir environment.backendUrl.
// El interceptor (auth-interceptor.ts) ya adjunta x-api-key + Bearer.
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private base = environment.backendUrl;

  get<T>(path: string, params?: Record<string, string | number>): Observable<T> {
    return this.http.get<T>(this.base + path, { params: params as never });
  }
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.base + path, body);
  }
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.base + path, body);
  }
  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.base + path, body);
  }
  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.base + path);
  }
}
