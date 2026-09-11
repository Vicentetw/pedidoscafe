import { Injectable, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  Auth as FirebaseAuth,
  getAuth,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { environment } from '../../environments/environment';

// Portado de core/auth.ts del sistema de asistencia — conserva los arreglos
// ganados a los golpes:
//   - authStateReady(): evita el 401 en la carga inicial (el primer callback
//     de onAuthStateChanged puede llegar con null aunque haya sesión).
//   - recarga COMPLETA del navegador en login/logout: evita que una pantalla
//     arranque con datos de la sesión anterior en una PC compartida.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly app = initializeApp(environment.firebaseConfig);
  private readonly auth: FirebaseAuth = getAuth(this.app);
  private readonly googleProvider = new GoogleAuthProvider();

  readonly user = signal<User | null>(null);
  readonly authChecked = signal(false);

  constructor() {
    onAuthStateChanged(this.auth, (user) => this.user.set(user));
    this.auth.authStateReady().then(() => {
      this.user.set(this.auth.currentUser);
      this.authChecked.set(true);
    });
  }

  ready(): Promise<User | null> {
    return this.auth.authStateReady().then(() => this.auth.currentUser);
  }

  private reloadLimpio(): void {
    window.location.href = '/';
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
    this.reloadLimpio();
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithPopup(this.auth, this.googleProvider);
    this.reloadLimpio();
  }

  async resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    this.reloadLimpio();
  }

  async getIdToken(): Promise<string | null> {
    await this.ready();
    const current = this.auth.currentUser;
    if (!current) return null;
    return current.getIdToken();
  }
}
