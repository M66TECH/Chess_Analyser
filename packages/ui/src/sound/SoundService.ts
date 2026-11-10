/**
 * SoundService - Web Audio API procedural synthesis for chess sound effects.
 *
 * Zero external audio files required, zero latency, zero licensing issues (100% synthetic).
 * Respects browser autoplay policies by lazily initializing AudioContext on the first user interaction.
 */

export type SoundEffect = 'move' | 'capture' | 'check' | 'castle' | 'blunder';

export class SoundService {
  private static instance: SoundService | null = null;
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.5;
  private isUnlocked: boolean = false;

  private static STORAGE_KEY = 'chess-analyzer:sound-enabled';

  private constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(SoundService.STORAGE_KEY);
        if (stored !== null) {
          this.enabled = stored === 'true';
        }
      } catch {
        this.enabled = true;
      }
    }
  }

  public static getInstance(): SoundService {
    if (!SoundService.instance) {
      SoundService.instance = new SoundService();
    }
    return SoundService.instance;
  }

  /**
   * Lazily initializes and unlocks the AudioContext.
   * Safe to call repeatedly; only acts once or upon resumption.
   */
  public unlockAudio(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.isUnlocked = true;
    } catch {
      // AudioContext unavailable or blocked
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(SoundService.STORAGE_KEY, String(enabled));
      } catch {}
    }
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * Play a specific sound effect using synthetic Web Audio pulses.
   */
  public play(effect: SoundEffect): void {
    if (!this.enabled) return;
    this.unlockAudio();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;

      switch (effect) {
        case 'move':
          this.synthesizeWoodHit(now, 220, 0.05, 0.8 * this.volume);
          break;
        case 'capture':
          this.synthesizeCapture(now);
          break;
        case 'check':
          this.synthesizeCheck(now);
          break;
        case 'castle':
          this.synthesizeCastle(now);
          break;
        case 'blunder':
          this.synthesizeBlunder(now);
          break;
      }
    } catch {
      // Ignore audio synthesis errors on unsupported environments
    }
  }

  /**
   * Short acoustic thud mimicking a wooden piece hitting felt/board.
   */
  private synthesizeWoodHit(time: number, freq: number, duration: number, gainValue: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, time + duration);

    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + duration);
  }

  /**
   * Double click impact with short white noise burst mimicking a capture.
   */
  private synthesizeCapture(time: number): void {
    if (!this.ctx) return;
    // Primary impact
    this.synthesizeWoodHit(time, 320, 0.045, 0.9 * this.volume);
    // Secondary snappy impact (piece knocked)
    this.synthesizeWoodHit(time + 0.03, 180, 0.06, 0.7 * this.volume);
  }

  /**
   * Resonant alert chime for check.
   */
  private synthesizeCheck(time: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, time); // D5
    osc.frequency.exponentialRampToValueAtTime(880, time + 0.18); // A5

    gain.gain.setValueAtTime(0.6 * this.volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + 0.22);
  }

  /**
   * Sliding double step for castling (King + Rook).
   */
  private synthesizeCastle(time: number): void {
    if (!this.ctx) return;
    this.synthesizeWoodHit(time, 240, 0.04, 0.7 * this.volume);
    this.synthesizeWoodHit(time + 0.08, 200, 0.05, 0.8 * this.volume);
  }

  /**
   * Low, soft warning thud for a blunder.
   */
  private synthesizeBlunder(time: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(70, time + 0.25);

    gain.gain.setValueAtTime(0.5 * this.volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + 0.25);
  }
}
