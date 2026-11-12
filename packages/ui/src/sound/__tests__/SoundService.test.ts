import { describe, it, expect, beforeEach } from 'vitest';
import { SoundService } from '../SoundService';

describe('SoundService', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset singleton instance if possible or test via getInstance
    const sound = SoundService.getInstance();
    sound.setEnabled(true);
    sound.setVolume(0.5);
  });

  it('provides a singleton instance', () => {
    const s1 = SoundService.getInstance();
    const s2 = SoundService.getInstance();
    expect(s1).toBe(s2);
  });

  it('toggles sound on and off and persists to localStorage', () => {
    const sound = SoundService.getInstance();
    expect(sound.isEnabled()).toBe(true);

    const toggled = sound.toggle();
    expect(toggled).toBe(false);
    expect(sound.isEnabled()).toBe(false);
    expect(localStorage.getItem('chess-analyzer:sound-enabled')).toBe('false');

    sound.toggle();
    expect(sound.isEnabled()).toBe(true);
    expect(localStorage.getItem('chess-analyzer:sound-enabled')).toBe('true');
  });

  it('clamps volume within [0, 1]', () => {
    const sound = SoundService.getInstance();
    sound.setVolume(1.5);
    expect(sound.getVolume()).toBe(1);

    sound.setVolume(-0.5);
    expect(sound.getVolume()).toBe(0);

    sound.setVolume(0.7);
    expect(sound.getVolume()).toBe(0.7);
  });

  it('safely calls play without crashing even when AudioContext is stubbed or unavailable', () => {
    const sound = SoundService.getInstance();
    expect(() => {
      sound.play('move');
      sound.play('capture');
      sound.play('check');
      sound.play('castle');
      sound.play('blunder');
    }).not.toThrow();
  });

  it('does not play when disabled', () => {
    const sound = SoundService.getInstance();
    sound.setEnabled(false);
    expect(() => sound.play('move')).not.toThrow();
  });

  it('does not crash or synthesize when volume is 0', () => {
    const sound = SoundService.getInstance();
    sound.setEnabled(true);
    sound.setVolume(0);
    expect(() => sound.play('move')).not.toThrow();
  });
});
