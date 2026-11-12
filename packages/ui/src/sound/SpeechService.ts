/**
 * SpeechService - Synthèse vocale pédagogique (Text-to-Speech) pour le Coach d'échecs.
 *
 * Utilise la Web Speech API native (window.speechSynthesis).
 * - 0 coût de serveur, 0 latence réseau, fonctionne en local et hors-ligne.
 * - Nettoyage phonétique intelligent des notations échiquéennes françaises et internationales.
 * - Sélection prioritaire des voix françaises naturelles/améliorées.
 * - Observable pour mise à jour réactive des composants UI.
 */

export interface SpeechState {
  isSpeaking: boolean;
  isPaused: boolean;
  currentText: string | null;
}

export type SpeechListener = (state: SpeechState) => void;

export interface SpeechOptions {
  rate?: number; // Vitesse (défaut: 1.0, recommandé: 0.95 - 1.05)
  pitch?: number; // Hauteur (défaut: 1.0)
  volume?: number; // Volume (0.0 à 1.0, défaut: 1.0)
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Traduit et normalise les notations échiquéennes et balises pour une prononciation
 * fluide, claire et naturelle en langue française.
 */
export function formatChessTextForSpeech(rawText: string): string {
  if (!rawText) return '';

  let text = rawText
    // Supprimer balises markdown basiques
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Roques
    .replace(/\bO-O-O\b|\b0-0-0\b/g, 'grand roque')
    .replace(/\bO-O\b|\b0-0\b/g, 'petit roque')
    // Échecs et mats en notation
    .replace(/(\w+)#/g, '$1 échec et mat')
    .replace(/(\w+)\+/g, '$1 échec')
    // Évaluations courantes
    .replace(/\+#(\d+)/g, 'mat forcé en $1 coups pour les blancs')
    .replace(/-#(\d+)/g, 'mat forcé en $1 coups pour les noirs')
    .replace(/\+([0-9]+)\.([0-9]+)/g, 'plus $1 virgule $2')
    .replace(/-([0-9]+)\.([0-9]+)/g, 'moins $1 virgule $2')
    .replace(/([0-9]+)\.([0-9]+)/g, '$1 virgule $2');

  // Pièces avec capture (ex: Txd7, Cxe5, Fxf7, Dxd8, Rxd1)
  text = text
    .replace(/\bC[x:]([a-h][1-8])\b/g, 'Cavalier prend $1')
    .replace(/\bF[x:]([a-h][1-8])\b/g, 'Fou prend $1')
    .replace(/\bT[x:]([a-h][1-8])\b/g, 'Tour prend $1')
    .replace(/\bD[x:]([a-h][1-8])\b/g, 'Dame prend $1')
    .replace(/\bR[x:]([a-h][1-8])\b/g, 'Roi prend $1')
    // SAN anglais avec capture
    .replace(/\bN[x:]([a-h][1-8])\b/g, 'Cavalier prend $1')
    .replace(/\bB[x:]([a-h][1-8])\b/g, 'Fou prend $1')
    .replace(/\bQ[x:]([a-h][1-8])\b/g, 'Dame prend $1')
    .replace(/\bK[x:]([a-h][1-8])\b/g, 'Roi prend $1')
    // Captures de pions (ex: exd5, cxe4)
    .replace(/\b([a-h])[x:]([a-h][1-8])\b/g, 'pion $1 prend $2');

  // Déplacement simple de pièces (ex: Cf3, Fb5, etc.)
  text = text
    .replace(/\bC([a-h][1-8])\b/g, 'Cavalier $1')
    .replace(/\bF([a-h][1-8])\b/g, 'Fou $1')
    .replace(/\bT([a-h][1-8])\b/g, 'Tour $1')
    .replace(/\bD([a-h][1-8])\b/g, 'Dame $1')
    .replace(/\bR([a-h][1-8])\b/g, 'Roi $1')
    .replace(/\bN([a-h][1-8])\b/g, 'Cavalier $1')
    .replace(/\bB([a-h][1-8])\b/g, 'Fou $1')
    .replace(/\bQ([a-h][1-8])\b/g, 'Dame $1')
    .replace(/\bK([a-h][1-8])\b/g, 'Roi $1');

  // Autres captures résiduelles
  text = text.replace(/(\w+)\s*x\s*(\w+)/gi, '$1 prend $2');

  // Espacer les coordonnées de cases (ex "f7" prononcé "f 7")
  text = text.replace(/\b([a-h])([1-8])\b/gi, '$1 $2');

  return text.trim();
}

export class SpeechService {
  private static instance: SpeechService | null = null;
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private listeners = new Set<SpeechListener>();
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentText: string | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  private state: SpeechState = {
    isSpeaking: false,
    isPaused: false,
    currentText: null,
  };

  private constructor() {
    this.getSynth();
  }

  public static getInstance(): SpeechService {
    if (!SpeechService.instance) {
      SpeechService.instance = new SpeechService();
    }
    return SpeechService.instance;
  }

  public static _resetForTesting(): void {
    if (SpeechService.instance) {
      SpeechService.instance.stop();
    }
    SpeechService.instance = null;
  }

  private getSynth(): SpeechSynthesis | null {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (!this.synth) {
        this.synth = window.speechSynthesis;
        this.initVoices();
        if (this.synth.onvoiceschanged !== undefined) {
          this.synth.onvoiceschanged = () => this.initVoices();
        }
      }
      return this.synth;
    }
    return null;
  }

  public isSupported(): boolean {
    return this.getSynth() !== null;
  }

  private initVoices(): void {
    const synth = this.getSynth();
    if (!synth) return;
    try {
      this.voices = synth.getVoices() || [];
      if (this.voices.length > 0) {
        this.selectedVoice = this.pickBestFrenchVoice(this.voices);
      }
    } catch {
      // Ignorer si indisponible
    }
  }

  /**
   * Sélectionne la voix française la plus naturelle possible.
   */
  private pickBestFrenchVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const frenchVoices = voices.filter(
      (v) => v.lang && (v.lang.toLowerCase().startsWith('fr') || v.lang.toLowerCase().includes('fr_'))
    );

    if (frenchVoices.length === 0) {
      return voices.find((v) => v.default) || voices[0] || null;
    }

    // Préférence pour les voix naturelles / haute qualité (Google, Microsoft, Siri, etc.)
    const premiumVoice = frenchVoices.find((v) => {
      const name = v.name.toLowerCase();
      return (
        name.includes('natural') ||
        name.includes('online') ||
        name.includes('google') ||
        name.includes('premium') ||
        name.includes('enhanced') ||
        name.includes('audrey') ||
        name.includes('thomas') ||
        name.includes('hortense')
      );
    });

    return premiumVoice || frenchVoices.find((v) => v.lang === 'fr-FR') || frenchVoices[0];
  }

  public getState(): SpeechState {
    return { ...this.state };
  }

  public subscribe(listener: SpeechListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const s = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(s);
      } catch {
        // Ignorer les erreurs d'un listener particulier
      }
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    if (typeof window !== 'undefined') {
      this.keepAliveTimer = setInterval(() => {
        const synth = this.getSynth();
        if (synth && this.state.isSpeaking && !this.state.isPaused) {
          try {
            synth.pause();
            synth.resume();
          } catch {}
        }
      }, 10000);
    }
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Lit le texte à voix haute en français avec nettoyage des termes échiquéens.
   */
  public speak(rawText: string, options: SpeechOptions = {}): void {
    const synth = this.getSynth();
    if (!synth || !rawText || rawText.trim().length === 0) return;

    // Arrêter toute lecture précédente
    this.stop();

    if (!this.selectedVoice && this.voices.length > 0) {
      this.selectedVoice = this.pickBestFrenchVoice(this.voices);
    }

    const spokenText = formatChessTextForSpeech(rawText);
    const utterance = new SpeechSynthesisUtterance(spokenText);

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice.lang || 'fr-FR';
    } else {
      utterance.lang = 'fr-FR';
    }

    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    utterance.onstart = () => {
      this.state = {
        isSpeaking: true,
        isPaused: false,
        currentText: rawText,
      };
      this.startKeepAlive();
      this.notify();
      options.onStart?.();
    };

    utterance.onend = () => {
      this.stopKeepAlive();
      this.currentUtterance = null;
      this.state = {
        isSpeaking: false,
        isPaused: false,
        currentText: null,
      };
      this.notify();
      options.onEnd?.();
    };

    utterance.onerror = (err) => {
      this.stopKeepAlive();
      this.currentUtterance = null;
      this.state = {
        isSpeaking: false,
        isPaused: false,
        currentText: null,
      };
      this.notify();
      options.onError?.(err);
    };

    utterance.onpause = () => {
      this.state = { ...this.state, isPaused: true };
      this.notify();
    };

    utterance.onresume = () => {
      this.state = { ...this.state, isPaused: false };
      this.notify();
    };

    this.currentUtterance = utterance;
    this.currentText = rawText;

    try {
      synth.speak(utterance);
    } catch (e) {
      options.onError?.(e);
    }
  }

  /**
   * Bascule entre lecture et arrêt pour un texte donné.
   */
  public toggle(text: string, options: SpeechOptions = {}): void {
    if (this.state.isSpeaking && this.state.currentText === text) {
      this.stop();
    } else {
      this.speak(text, options);
    }
  }

  public pause(): void {
    const synth = this.getSynth();
    if (synth && this.state.isSpeaking && !this.state.isPaused) {
      try {
        synth.pause();
      } catch {}
    }
  }

  public resume(): void {
    const synth = this.getSynth();
    if (synth && this.state.isSpeaking && this.state.isPaused) {
      try {
        synth.resume();
      } catch {}
    }
  }

  public stop(): void {
    this.stopKeepAlive();
    const synth = this.getSynth();
    if (synth) {
      try {
        synth.cancel();
      } catch {}
    }
    this.currentUtterance = null;
    this.currentText = null;
    if (this.state.isSpeaking || this.state.isPaused) {
      this.state = {
        isSpeaking: false,
        isPaused: false,
        currentText: null,
      };
      this.notify();
    }
  }
}
