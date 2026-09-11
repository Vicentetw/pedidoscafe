import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../core/api';

interface PublicVariant { code: string; name: string; price: string; isDefault: boolean; }
interface PublicProduct {
  code: string; name: string; description: string | null; price: string; currency: string;
  available: boolean; requiresAgeVerification: boolean; variants: PublicVariant[];
  tags: { code: string; label: string; color: string | null }[];
}
interface PublicCategory { code: string; name: string; icon: string | null; products: PublicProduct[]; }
interface PublicMenu { code: string; name: string; categories: PublicCategory[]; }
interface MenuResponse { branch: { code: string; name: string }; menus: PublicMenu[]; }

// Menú público de vidriera — /m/:tenantSlug/:branchCode. Sin login.
@Component({
  selector: 'app-menu-public-page',
  template: `
    <div class="wrap">
      @if (loading()) {
        <p class="muted center">Cargando el menú…</p>
      } @else if (error()) {
        <div class="card"><p>{{ error() }}</p></div>
      } @else if (data(); as d) {
        <header>
          <h1>{{ d.branch.name }}</h1>
        </header>
        @for (menu of d.menus; track menu.code) {
          @for (cat of menu.categories; track cat.code) {
            <section>
              <h2>@if (cat.icon) { <span class="icon">{{ cat.icon }}</span> } {{ cat.name }}</h2>
              @for (p of cat.products; track p.code) {
                <article class="item" [class.off]="!p.available">
                  <div class="line">
                    <span class="name">{{ p.name }}</span>
                    <span class="price">{{ p.currency }} {{ p.price }}</span>
                  </div>
                  @if (p.description) { <p class="desc">{{ p.description }}</p> }
                  @if (p.variants.length) {
                    <ul class="variants">
                      @for (v of p.variants; track v.code) {
                        <li>{{ v.name }} <span class="muted">— {{ p.currency }} {{ v.price }}</span></li>
                      }
                    </ul>
                  }
                  @if (!p.available) { <span class="badge">Sin stock</span> }
                </article>
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: [`
    .wrap { max-width: 560px; margin: 0 auto; padding: var(--space-4) var(--space-4) var(--space-6); }
    .center { text-align: center; padding-top: 30vh; }
    header { padding: var(--space-2) 0 var(--space-3); }
    header h1 { margin: 0; }
    section { margin-bottom: var(--space-5); }
    h2 { font-size: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .icon { font-size: 1.15em; }
    .item { padding: 12px 0; border-bottom: 1px solid var(--border); }
    .item:last-child { border-bottom: none; }
    .item.off { opacity: .5; }
    .line { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .name { font-weight: 600; }
    .price { color: var(--primary); font-weight: 600; white-space: nowrap; }
    .desc { margin: 4px 0 0; color: var(--muted); font-size: .88rem; }
    .variants { margin: 8px 0 0; padding: 0; list-style: none; font-size: .88rem; display: flex; flex-direction: column; gap: 2px; }
  `],
})
export class MenuPublicPage implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);

  readonly data = signal<MenuResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('tenantSlug');
    const branch = this.route.snapshot.paramMap.get('branchCode');
    this.api.get<MenuResponse>(`/api/public/menu/${slug}/${branch}`).subscribe({
      next: (r) => { this.data.set(r); this.loading.set(false); },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudo cargar el menú.');
        this.loading.set(false);
      },
    });
  }
}
