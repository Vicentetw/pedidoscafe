import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

// Estado de la sesión de mesa del comensal (superficie sin login). Guarda
// el table_session_token en localStorage, con una clave POR MESA (por
// qrToken) — así, si alguien cierra la pestaña/app y vuelve a entrar con
// el MISMO link (lo normal: cerró el navegador, volvió más tarde a pedir
// algo más), recupera SU MISMO participante en vez de sumar uno nuevo.
// Antes usaba sessionStorage con una clave fija: sobrevivía sólo mientras
// la pestaña seguía abierta, así que salir y volver a entrar creaba un
// participante nuevo cada vez — con su propio pedido, inaccesible desde
// el nuevo participante, y saldos que nunca cerraban (bug real encontrado
// en la aceptación: "puedo generar 5 nombres Vicente"). El token vence
// solo a las SESSION_TOKEN_TTL_HOURS igual que antes (el backend lo
// valida); si venció, se limpia y se vuelve a pedir el nombre — ahí sí
// hace falta un participante nuevo, no hay forma de evitarlo.
// Todas las llamadas a /api/session mandan ese token como Bearer — el
// interceptor de Firebase no lo pisa (un invitado no tiene sesión de Firebase).
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

  readonly token = signal<string | null>(null);
  readonly state = signal<GuestSessionState | null>(null);

  private key(qrToken: string) { return `pc.session.${qrToken}`; }
  private currentQr: string | null = null;

  // Se llama ANTES de mostrar la pantalla de "¿cómo te llamás?" — si hay un
  // token guardado para ESTA mesa, lo carga (todavía no se sabe si sigue
  // vigente; eso lo confirma el primer refresh()).
  loadStoredToken(qrToken: string): string | null {
    this.currentQr = qrToken;
    let t: string | null = null;
    try { t = localStorage.getItem(this.key(qrToken)); } catch { /* ignore */ }
    this.token.set(t);
    return t;
  }
  private saveToken(qrToken: string, t: string) {
    this.token.set(t);
    try { localStorage.setItem(this.key(qrToken), t); } catch { /* ignore */ }
  }
  clear() {
    this.token.set(null);
    this.state.set(null);
    if (this.currentQr) { try { localStorage.removeItem(this.key(this.currentQr)); } catch { /* ignore */ } }
  }

  resolveQr(qrToken: string) {
    this.currentQr = qrToken;
    return firstValueFrom(
      this.http.get<{ tenant: { slug: string; name: string }; branch: { code: string; name: string }; table: { code: string; name: string | null }; needsCaptcha: boolean }>(
        `${this.base}/api/public/qr/${encodeURIComponent(qrToken)}/resolve`
      )
    );
  }

  async startSession(qrToken: string, displayName: string, turnstileToken?: string, claim = false) {
    const res = await firstValueFrom(
      this.http.post<{ token: string; session: any; participant: any; othersPresent: number; table: any; branch: any }>(
        `${this.base}/api/public/table-sessions`,
        { qrToken, displayName, turnstileToken, claim }
      )
    );
    this.saveToken(qrToken, res.token);
    await this.refresh();
    return res;
  }

  private authHeaders(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  // Si el token guardado ya venció (o la mesa se cerró), el backend
  // devuelve 401/404 — ahí lo limpiamos para no quedar reintentando con un
  // token muerto en cada llamada; quien use esto vuelve a mostrar la
  // pantalla de "¿cómo te llamás?" (recién ahí es inevitable un participante
  // nuevo, porque el anterior ya no es identificable).
  async refresh() {
    const t = this.token();
    if (!t) return null;
    try {
      const s = await firstValueFrom(
        this.http.get<GuestSessionState>(`${this.base}/api/session`, { headers: this.authHeaders() })
      );
      this.state.set(s);
      return s;
    } catch (e: any) {
      // 401/404 = token vencido o mesa inexistente; SESSION_CLOSED = la
      // mesa se cerró (force-close u otro) — en los tres casos el token
      // guardado ya no sirve, hay que limpiarlo.
      if (e?.status === 401 || e?.status === 404 || e?.error?.code === 'SESSION_CLOSED') this.clear();
      throw e;
    }
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
  // "Ya terminamos de pedir" — confirma TODOS los pedidos sin confirmar de
  // la mesa de una vez (no sólo los míos), para avisarle a cocina.
  closeAllOrders() {
    return firstValueFrom(this.http.post<{ submitted: number[]; skipped: { orderId: number; participant: string | null; reason: string }[] }>(
      `${this.base}/api/session/orders/close-all`, {}, { headers: this.authHeaders() }
    ));
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
