/**
 * Mode local strict (P3.14).
 *
 * Interrupteur global : quand il est actif, AUCUNE donnée ne quitte le
 * navigateur. Les modules qui pourraient appeler un service distant
 * (explorateur Lichess, cloud eval, coach LLM) consultent `LocalMode.enabled`
 * avant d'émettre la requête.
 *
 * Choix de conception : un module d'état unique plutôt qu'un paramètre à
 * propager partout. Les services sont statiques et appelés de manière
 * dispersée (pipeline, page, hooks) ; un flag central évite d'oublier un
 * point d'entrée — un oubli = fuite de données silencieuse.
 */

type Listener = (enabled: boolean) => void;

const STORAGE_KEY = 'chess-analyzer:local-only';

export class LocalMode {
  private static _enabled = false;
  private static listeners: Listener[] = [];
  private static loaded = false;

  /** Charge la préférence persistée (une fois). */
  private static ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (typeof localStorage !== 'undefined') {
        this._enabled = localStorage.getItem(STORAGE_KEY) === 'true';
      }
    } catch {
      // localStorage indisponible : le mode reste désactivé (comportement sûr).
    }
  }

  /** `true` = mode local strict : aucun appel réseau sortant autorisé. */
  public static get enabled(): boolean {
    this.ensureLoaded();
    return this._enabled;
  }

  /** Activation explicite (tests, initialisation). */
  public static set enabled(value: boolean) {
    this.ensureLoaded();
    if (this._enabled === value) return;
    this._enabled = value;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, String(value));
      }
    } catch {
      // Persistance best-effort.
    }
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (error) {
        console.error('[LocalMode] listener error:', error);
      }
    }
  }

  public static toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** S'abonner aux changements (l'UI met à jour son badge). */
  public static onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Garde-fou à appeler avant toute requête sortante :
   *   if (!LocalMode.allowRemote('opening-explorer')) return null;
   * Le paramètre documente l'appelant (logs, tests).
   */
  public static allowRemote(_caller: string): boolean {
    void _caller;
    this.ensureLoaded();
    return !this._enabled;
  }

  /** Réinitialise l'état persisté (tests). */
  public static reset(): void {
    this.loaded = true;
    this._enabled = false;
    this.listeners = [];
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}
