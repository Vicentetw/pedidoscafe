import { Component, OnDestroy, OnInit, signal } from '@angular/core';

const MESSAGES = [
  'Despertando la máquina de café… ☕',
  'Esto puede tardar unos segundos la primera vez.',
  'El barista ya casi termina tu pedido…',
];

// Pantalla de espera para cuando el backend tarda en contestar (server
// gratis "dormido" en Render, o cualquier carga larga) — pedido explícito
// en la aceptación: una animación agradable en vez de una pantalla en
// blanco o un "Cargando…" seco. Sólo emoji + CSS (sin imágenes externas:
// se banca cualquier red, y funciona igual en modo claro/oscuro).
@Component({
  selector: 'app-loading-barista',
  template: `
    <div class="wrap">
      <div class="scene">
        <span class="steam s1">〜</span>
        <span class="steam s2">〜</span>
        <span class="steam s3">〜</span>
        <span class="barista">🧑‍🍳</span>
        <span class="cup">☕</span>
      </div>
      <p class="msg">{{ messages[i()] }}</p>
    </div>
  `,
  styles: [`
    .wrap { display: grid; place-items: center; min-height: 100dvh; gap: var(--space-4); padding: var(--space-4); text-align: center; }
    .scene { position: relative; width: 140px; height: 140px; }
    .cup {
      position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
      font-size: 3.6rem; line-height: 1; animation: wobble 2.2s ease-in-out infinite;
    }
    .barista {
      position: absolute; top: -6px; right: 6px; font-size: 2rem; line-height: 1;
      animation: bounce 1.3s ease-in-out infinite;
    }
    .steam {
      position: absolute; bottom: 62px; left: 50%; font-size: 1.4rem; font-weight: 700;
      color: var(--muted); opacity: 0; animation: rise 2.4s ease-in infinite;
    }
    .steam.s1 { transform: translateX(-22px); animation-delay: 0s; }
    .steam.s2 { transform: translateX(-2px); animation-delay: .8s; }
    .steam.s3 { transform: translateX(16px); animation-delay: 1.6s; }
    .msg { color: var(--muted); font-size: .95rem; max-width: 320px; min-height: 1.4em; }

    @keyframes rise {
      0%   { opacity: 0; transform: translate(var(--dx, 0), 0) scale(.8); }
      25%  { opacity: .8; }
      100% { opacity: 0; transform: translate(var(--dx, 0), -46px) scale(1.15); }
    }
    .steam.s1 { --dx: -22px; }
    .steam.s2 { --dx: -2px; }
    .steam.s3 { --dx: 16px; }
    @keyframes wobble {
      0%, 100% { transform: translateX(-50%) rotate(0deg); }
      25% { transform: translateX(-50%) rotate(-4deg); }
      75% { transform: translateX(-50%) rotate(4deg); }
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .cup, .barista, .steam { animation: none; }
      .steam { opacity: .6; }
    }
  `],
})
export class LoadingBarista implements OnInit, OnDestroy {
  readonly messages = MESSAGES;
  readonly i = signal(0);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.timer = setInterval(() => this.i.set((this.i() + 1) % this.messages.length), 2600);
  }
  ngOnDestroy() { clearInterval(this.timer); }
}
