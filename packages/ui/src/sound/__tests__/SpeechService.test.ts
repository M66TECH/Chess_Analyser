import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechService, formatChessTextForSpeech } from '../SpeechService';

describe('formatChessTextForSpeech', () => {
  it('supprime les balises markdown', () => {
    const text = 'Voici un coup **très fort** et *subtil*, comme `e4`.';
    const result = formatChessTextForSpeech(text);
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
    expect(result).not.toContain('`');
    expect(result).toContain('très fort');
  });

  it('traduit les pièces et captures françaises pour la voix', () => {
    const text = 'Après Cf3 et Fb5, les blancs jouent Txd7+ suivi de Dh5#';
    const result = formatChessTextForSpeech(text);
    expect(result).toContain('Cavalier f 3');
    expect(result).toContain('Fou b 5');
    expect(result).toContain('Tour prend d 7 échec');
    expect(result).toContain('Dame h 5 échec et mat');
  });

  it('traduit les roques', () => {
    expect(formatChessTextForSpeech('Les noirs font O-O')).toContain('petit roque');
    expect(formatChessTextForSpeech('Les blancs font O-O-O')).toContain('grand roque');
  });

  it('traduit les évaluations numériques et mats', () => {
    const text = 'Avantage de +1.5 pions et menace de +#3';
    const result = formatChessTextForSpeech(text);
    expect(result).toContain('plus 1 virgule 5');
    expect(result).toContain('mat forcé en 3 coups pour les blancs');
  });
});

describe('SpeechService (API & State)', () => {
  let mockSpeak: ReturnType<typeof vi.fn>;
  let mockCancel: ReturnType<typeof vi.fn>;
  let mockPause: ReturnType<typeof vi.fn>;
  let mockResume: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    SpeechService._resetForTesting();

    mockSpeak = vi.fn();
    mockCancel = vi.fn();
    mockPause = vi.fn();
    mockResume = vi.fn();

    const mockSynth = {
      speak: mockSpeak,
      cancel: mockCancel,
      pause: mockPause,
      resume: mockResume,
      getVoices: () => [
        { name: 'Google français', lang: 'fr-FR', default: true },
        { name: 'Microsoft Paul', lang: 'fr-FR', default: false },
        { name: 'English Voice', lang: 'en-US', default: false },
      ],
      onvoiceschanged: null,
    };

    // Assigner à window et global
    if (typeof window !== 'undefined') {
      (window as unknown as { speechSynthesis: unknown }).speechSynthesis = mockSynth;
    }
    (global as unknown as { speechSynthesis: unknown }).speechSynthesis = mockSynth;

    // Mock SpeechSynthesisUtterance
    class MockUtterance {
      text: string;
      lang = '';
      voice = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    if (typeof window !== 'undefined') {
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
    }
    (global as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
  });

  afterEach(() => {
    SpeechService.getInstance().stop();
    SpeechService._resetForTesting();
  });

  it('signale isSupported=true si speechSynthesis est présent', () => {
    const service = SpeechService.getInstance();
    expect(service.isSupported()).toBe(true);
  });

  it('appelle speak et notifie les abonnés', () => {
    const service = SpeechService.getInstance();
    const states: boolean[] = [];

    const unsubscribe = service.subscribe((s) => {
      states.push(s.isSpeaking);
    });

    service.speak('Superbe coup avec Cf3 !');
    expect(mockSpeak).toHaveBeenCalledTimes(1);

    // Déclencher artificiellement onstart
    const utterance = mockSpeak.mock.calls[0][0];
    utterance.onstart();

    expect(service.getState().isSpeaking).toBe(true);
    expect(service.getState().currentText).toBe('Superbe coup avec Cf3 !');

    // Déclencher onend
    utterance.onend();
    expect(service.getState().isSpeaking).toBe(false);

    unsubscribe();
  });

  it('stop() annule la synthèse vocale en cours', () => {
    const service = SpeechService.getInstance();
    service.speak('Test');
    service.stop();
    expect(mockCancel).toHaveBeenCalled();
    expect(service.getState().isSpeaking).toBe(false);
  });

  it('toggle() bascule entre lecture et arrêt', () => {
    const service = SpeechService.getInstance();
    service.speak('Texte unique');
    const utterance = mockSpeak.mock.calls[0][0];
    utterance.onstart();

    expect(service.getState().isSpeaking).toBe(true);

    // Bascule avec le même texte -> stop
    service.toggle('Texte unique');
    expect(mockCancel).toHaveBeenCalled();
  });
});
