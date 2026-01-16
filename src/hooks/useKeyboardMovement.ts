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
  controlMode?: 'joystick' | 'gamepad' | 'keyboard' | 'location';
  /** Whether ESC should work in all modes (default: true) */
  escWorksInAllModes?: boolean;
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
  const lastInputRef = useRef<KeyboardMovementInput>({ forward: 0, turn: 0 });
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
    let forward = 0;
    let turn = 0;

    if (keys.has('KeyW')) forward += 0.5;
    if (keys.has('KeyS')) forward -= 0.5;

    if (keys.has('KeyA')) turn -= 1.0;
    if (keys.has('KeyD')) turn += 1.0;

    return { forward, turn };
  }, []);

  const updateMovement = useCallback(() => {
    const movement = calculateMovement();
    
    if (
      movement.forward !== lastInputRef.current.forward ||
      movement.turn !== lastInputRef.current.turn
    ) {
      lastInputRef.current = movement;
      
      if (movement.forward === 0 && movement.turn === 0) {
        if (onStop) {
          onStop();
        }
      } else {
        onInput(movement);
      }
    }
  }, [calculateMovement, onInput, onStop]);

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

    if (controlMode !== 'keyboard') {
      return;
    }

    if (!enabled) {
      return;
    }

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault(); // Prevent default browser behavior
      
      pressedKeysRef.current.add(event.code);
      updatePressedKeysState();
      updateMovement();
    }
  }, [enabled, controlMode, onEndSession, updateMovement, escWorksInAllModes, updatePressedKeysState, isEditableTarget]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      if (escWorksInAllModes || controlMode === 'keyboard') {
        event.preventDefault();
        pressedKeysRef.current.delete('Escape');
        updatePressedKeysState();
      }
      return;
    }

    if (!enabled || controlMode !== 'keyboard') return;

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      
      pressedKeysRef.current.delete(event.code);
      updatePressedKeysState();
      updateMovement();
    }
  }, [enabled, controlMode, updateMovement, escWorksInAllModes, updatePressedKeysState, isEditableTarget]);

  useEffect(() => {
    const shouldListenForEsc = escWorksInAllModes || controlMode === 'keyboard';
    const shouldListenForWASD = enabled && controlMode === 'keyboard';

    if (shouldListenForEsc || shouldListenForWASD) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    } else {
      pressedKeysRef.current.clear();
      setPressedKeys([]);
      if (lastInputRef.current.forward !== 0 || lastInputRef.current.turn !== 0) {
        lastInputRef.current = { forward: 0, turn: 0 };
        if (onStop) {
          onStop();
        }
      }
      return;
    }

    const handleBlur = () => {
      pressedKeysRef.current.clear();
      setPressedKeys([]);
      lastInputRef.current = { forward: 0, turn: 0 };
      if (onStop) {
        onStop();
      }
    };

    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      
      pressedKeysRef.current.clear();
      lastInputRef.current = { forward: 0, turn: 0 };
      if (onStop) {
        onStop();
      }
    };
  }, [enabled, controlMode, handleKeyDown, handleKeyUp, onStop, escWorksInAllModes]);

  return {
    isActive: pressedKeys.length > 0,
    pressedKeys: pressedKeys,
  };
}

