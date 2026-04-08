import { useEffect, useRef, useCallback, useState } from 'react';
import { logger } from '../utils/logger';

export interface KeyboardMovementInput {
  forward: number;
  turn: number;
}

export interface UseKeyboardMovementOptions {
  enabled?: boolean;
  onInput: (input: KeyboardMovementInput) => void;
  onStop?: () => void;
  onEndSession?: () => void;
  /** Control mode - only active when mode is 'keyboard' */
  controlMode?: 'joystick' | 'gamepad' | 'keyboard' | 'location' | 'config';
  /** Whether ESC should work in all modes (default: true) */
  escWorksInAllModes?: boolean;
}

// Ramp-up config: speed increases from MIN to MAX over RAMP_MS while key is held
const FORWARD_MIN = 0.1;
const FORWARD_MAX = 0.5;
const TURN_MIN = 0.2;
const TURN_MAX = 1.0;
const RAMP_MS = 800;
const TICK_MS = 50;

const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

function ramp(holdMs: number, min: number, max: number): number {
  const t = Math.min(holdMs / RAMP_MS, 1);
  return min + (max - min) * t;
}

export function useKeyboardMovement({
  enabled = true,
  onInput,
  onStop,
  onEndSession,
  controlMode = 'joystick',
  escWorksInAllModes = true,
}: UseKeyboardMovementOptions) {
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const keyTimestamps = useRef<Map<string, number>>(new Map());
  const lastInputRef = useRef<KeyboardMovementInput>({ forward: 0, turn: 0 });
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);

  const isEditableTarget = useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }, []);

  const updatePressedKeysState = useCallback(() => {
    const newKeys = Array.from(pressedKeysRef.current).sort();
    setPressedKeys(prev => {
      const prevSorted = [...prev].sort();
      if (newKeys.length !== prevSorted.length || 
          !newKeys.every((key, i) => key === prevSorted[i])) {
        return newKeys;
      }
      return prev;
    });
  }, []);

  const calculateMovement = useCallback((): KeyboardMovementInput => {
    const keys = pressedKeysRef.current;
    const now = Date.now();
    let forward = 0;
    let turn = 0;

    const held = (key: string) => now - (keyTimestamps.current.get(key) ?? now);

    if (keys.has('KeyW')) forward += ramp(held('KeyW'), FORWARD_MIN, FORWARD_MAX);
    if (keys.has('KeyS')) forward -= ramp(held('KeyS'), FORWARD_MIN, FORWARD_MAX);
    if (keys.has('KeyA')) turn -= ramp(held('KeyA'), TURN_MIN, TURN_MAX);
    if (keys.has('KeyD')) turn += ramp(held('KeyD'), TURN_MIN, TURN_MAX);

    return { forward, turn };
  }, []);

  const emitMovement = useCallback(() => {
    const movement = calculateMovement();
    lastInputRef.current = movement;
    if (movement.forward === 0 && movement.turn === 0) {
      onStop?.();
    } else {
      onInput(movement);
    }
  }, [calculateMovement, onInput, onStop]);

  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(emitMovement, TICK_MS);
  }, [emitMovement]);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const clearAll = useCallback(() => {
    pressedKeysRef.current.clear();
    keyTimestamps.current.clear();
    setPressedKeys([]);
    stopTick();
    if (lastInputRef.current.forward !== 0 || lastInputRef.current.turn !== 0) {
      lastInputRef.current = { forward: 0, turn: 0 };
      onStop?.();
    }
  }, [stopTick, onStop]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      if (escWorksInAllModes || controlMode === 'keyboard') {
        event.preventDefault();
        pressedKeysRef.current.add('Escape');
        updatePressedKeysState();
        if (onEndSession) {
          logger.log('[useKeyboardMovement] ESC pressed, ending session');
          onEndSession();
        } else {
          logger.warn('[useKeyboardMovement] ESC pressed but onEndSession is not provided');
        }
        setTimeout(() => {
          pressedKeysRef.current.delete('Escape');
          updatePressedKeysState();
        }, 200);
      }
      return;
    }

    if (controlMode !== 'keyboard' || !enabled) return;

    if (WASD.includes(event.code)) {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();

      if (!pressedKeysRef.current.has(event.code)) {
        pressedKeysRef.current.add(event.code);
        keyTimestamps.current.set(event.code, Date.now());
        updatePressedKeysState();
      }
      emitMovement();
      startTick();
    }
  }, [enabled, controlMode, onEndSession, emitMovement, startTick, escWorksInAllModes, updatePressedKeysState, isEditableTarget]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      if (escWorksInAllModes || controlMode === 'keyboard') {
        event.preventDefault();
        pressedKeysRef.current.delete('Escape');
        updatePressedKeysState();
      }
      return;
    }

    // Always process WASD keyup to prevent the robot from "sticking" when
    // focus moved to an input/textarea or control mode changed mid-press.
    if (WASD.includes(event.code)) {
      pressedKeysRef.current.delete(event.code);
      keyTimestamps.current.delete(event.code);
      updatePressedKeysState();

      const hasMovementKeys = WASD.some(k => pressedKeysRef.current.has(k));
      if (!hasMovementKeys) stopTick();
      emitMovement();

      if (enabled && controlMode === 'keyboard' && !isEditableTarget(event.target)) {
        event.preventDefault();
      }
    }
  }, [enabled, controlMode, emitMovement, stopTick, escWorksInAllModes, updatePressedKeysState, isEditableTarget]);

  useEffect(() => {
    const shouldListenForEsc = escWorksInAllModes || controlMode === 'keyboard';
    const shouldListenForWASD = enabled && controlMode === 'keyboard';

    if (shouldListenForEsc || shouldListenForWASD) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    } else {
      clearAll();
      return;
    }

    const handleBlur = () => clearAll();
    const handleVisibilityChange = () => { if (document.hidden) clearAll(); };

    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearAll();
    };
  }, [enabled, controlMode, handleKeyDown, handleKeyUp, clearAll, escWorksInAllModes]);

  return {
    isActive: pressedKeys.length > 0,
    pressedKeys: pressedKeys,
  };
}

