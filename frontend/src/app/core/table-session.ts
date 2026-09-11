import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

// Estado de la sesión de mesa del comensal (superficie sin login). Guarda
// el table_session_token en sessionStorage para sobrevivir un refresh
// mientras dura la pestaña. Todas las llamadas a /api/session mandan ese
// token como Bearer — el interceptor de Firebase no lo pisa (un invitado
// no tiene sesión de Firebase).
export interface GuestParticipant { id: string; name: string; isYou: boolean; seatNo: number | null; }
export interface GuestSessionState {
  session: { id: string; status: string; orderMode: 'INDIVIDUAL' | 'GROUP'; total: string; paid: string; currency: string };
  you: number;
  allowIndividualPayment: boolean;
  participants: GuestParticipant[];
}

@Injectable({ providedIn: 'root' })
export class TableSessionService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.backendUrl;

  readonly token = signal<string | null>(this.readToken());
  readonly state = signal<GuestSessionState | null>(null);

  private key(qrToken: string) { return `pc.session.${qrToken}`; }
  private currentQr: string | null = null;

  private readToken(): string | null {
    try { return sessionStorage.getItem('pc.session.token'); } catch { return null; }
  }
  private saveToken(t: string) {
    this.token.set(t);
    try { sessionStorage.setItem('pc.session.token', t); } catch { /* ignore */ }
  }
  clear() {
    this.token.set(null);
    this.state.set(null);
    try { sessionStorage.removeItem('pc.session.token'); } catch { /* ignore */ }
  }

  resolveQr(qrToken: string) {
    this.currentQr = qrToken;
    return firstValueFrom(
      this.http.get<{ tenant: { slug: string; name: string }; branch: { code: string; name: string }; table: { code: string; name: string | null }; needsCaptcha: boolean }>(
        `${this.base}/api/public/qr/${encodeURIComponent(qrToken)}/resolve`
      )
    );
  }

  async startSession(qrToken: string, displayName: string, turnstileToken?: string) {
    const res = await firstValueFrom(
      this.http.post<{ token: string; session: any; participant: any; othersPresent: number; table: any; branch: any }>(
        `${this.base}/api/public/table-sessions`,
        { qrToken, displayName, turnstileToken }
      )
    );
    this.saveToken(res.token);
    await this.refresh();
    return res;
  }

  private authHeaders(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async refresh() {
    const t = this.token();
    if (!t) return null;
    const s = await firstValueFrom(
      this.http.get<GuestSessionState>(`${this.base}/api/session`, { headers: this.authHeaders() })
    );
    this.state.set(s);
    return s;
  }

  async addParticipant(displayName: string) {
    await firstValueFrom(
      this.http.post(`${this.base}/api/session/participants`, { displayName }, { headers: this.authHeaders() })
    );
    return this.refresh();
  }

  async removeParticipant(participantPublicId: string) {
    await firstValueFrom(
      this.http.delete<{ removed: boolean }>(`${this.base}/api/session/participants/${participantPublicId}`, { headers: this.authHeaders() })
    );
    return this.refresh();
  }

  async setOrderMode(orderMode: 'INDIVIDUAL' | 'GROUP') {
    await firstValueFrom(
      this.http.put(`${this.base}/api/session/order-mode`, { orderMode }, { headers: this.authHeaders() })
    );
    return this.refresh();
  }

  // -------- pedidos del comensal (Fase 4) --------
  menu(tenantSlug: string, branchCode: string) {
    return firstValueFrom(this.http.get<any>(`${this.base}/api/public/menu/${tenantSlug}/${branchCode}`));
  }
  myOrders() {
    return firstValueFrom(this.http.get<any>(`${this.base}/api/session/orders`, { headers: this.authHeaders() }));
  }
  createOrder() {
    return firstValueFrom(this.http.post<any>(`${this.base}/api/session/orders`, {}, { headers: this.authHeaders() }));
  }
  // orderId es SIEMPRE el id numérico interno del pedido (no public_id): el
  // backend gatea estas rutas por table_session_token + dueño del pedido,
  // así que exponer el id numérico acá no filtra nada entre tenants — y es
  // el mismo contrato que usan las rutas de staff. Pasar public_id rompía
  // con "Unknown column 'NaN'" (bug real encontrado en aceptación).
  addOrderItem(orderId: number, body: { productCode: string; variantCode?: string | null; modifierCodes?: string[]; qty: number }) {
    return firstValueFrom(this.http.post<any>(`${this.base}/api/session/orders/${orderId}/items`, body, { headers: this.authHeaders() }));
  }
  removeOrderItem(orderId: number, itemId: number) {
    return firstValueFrom(this.http.delete(`${this.base}/api/session/orders/${orderId}/items/${itemId}`, { headers: this.authHeaders() }));
  }
  submitOrder(orderId: number) {
    return firstValueFrom(this.http.post<any>(`${this.base}/api/session/orders/${orderId}/submit`, {}, { headers: this.authHeaders() }));
  }

  // -------- pagos del comensal (Fase 6) — sólo online; el efectivo lo cobra el mostrador
  balance() {
    return firstValueFrom(this.http.get<any>(`${this.base}/api/session/payments/balance`, { headers: this.authHeaders() }));
  }
  pay(mode: 'GROUP' | 'INDIVIDUAL') {
    return firstValueFrom(this.http.post<any>(`${this.base}/api/session/payments`, { mode }, { headers: this.authHeaders() }));
  }

  // SSE de la sesión (participantes que entran, cambios de modo). Devuelve
  // una función para cerrar el stream.
  openStream(onEvent: (type: string, data: any) => void): () => void {
    const t = this.token();
    if (!t) return () => {};
    // EventSource no permite headers → el token va como query param, sólo
    // aceptado en /api/session/stream.
    const url = `${this.base}/api/session/stream?access_token=${encodeURIComponent(t)}`;
    const es = new EventSource(url);
    const handler = (e: MessageEvent) => onEvent(e.type, safeParse(e.data));
    for (const ev of ['participant_joined', 'order_mode_changed', 'session_closed']) es.addEventListener(ev, handler);
    es.onerror = () => { /* el navegador reintenta solo */ };
    return () => es.close();
  }
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return s; } }
