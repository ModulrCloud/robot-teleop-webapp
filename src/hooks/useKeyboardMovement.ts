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

/**
 * Hook to handle keyboard movement controls (WASD keys)
 * 
 * This hook:
 * - Listens for WASD key presses for movement
 * - Listens for ESC key to end session
 * - Tracks which keys are currently pressed
 * - Sends movement commands when keys are pressed
 * - Stops movement when all keys are released
 */
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
  
  // Helper function to update pressed keys state only if contents changed
  const updatePressedKeysState = useCallback(() => {
    const newKeys = Array.from(pressedKeysRef.current).sort();
    setPressedKeys(prev => {
      const prevSorted = [...prev].sort();
      // Only update if contents actually changed
      if (newKeys.length !== prevSorted.length || 
          !newKeys.every((key, i) => key === prevSorted[i])) {
        return newKeys;
      }
      return prev; // Return same reference if no change
    });
  }, []);

  // Calculate movement from currently pressed keys
  const calculateMovement = useCallback((): KeyboardMovementInput => {
    const keys = pressedKeysRef.current;
    let forward = 0;
    let turn = 0;

    // Forward/Backward
    if (keys.has('KeyW')) forward += 0.5;
    if (keys.has('KeyS')) forward -= 0.5;

    // Turn Left/Right
    if (keys.has('KeyA')) turn -= 1.0;
    if (keys.has('KeyD')) turn += 1.0;

    return { forward, turn };
  }, []);

  // Update movement when keys change
  const updateMovement = useCallback(() => {
    const movement = calculateMovement();
    
    // Only send if movement changed or if we need to stop
    if (
      movement.forward !== lastInputRef.current.forward ||
      movement.turn !== lastInputRef.current.turn
    ) {
      lastInputRef.current = movement;
      
      if (movement.forward === 0 && movement.turn === 0) {
        // All keys released - stop movement
        if (onStop) {
          onStop();
        }
      } else {
        // Send movement command
        onInput(movement);
      }
    }
  }, [calculateMovement, onInput, onStop]);

  // Handle keydown events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Handle ESC key to end session (works in all modes if enabled)
    if (event.code === 'Escape') {
      if (escWorksInAllModes || controlMode === 'keyboard') {
        event.preventDefault();
        // Track ESC for visual feedback
        pressedKeysRef.current.add('Escape');
        updatePressedKeysState();
        if (onEndSession) {
          logger.log('[useKeyboardMovement] ESC pressed, ending session');
          onEndSession();
        } else {
          logger.warn('[useKeyboardMovement] ESC pressed but onEndSession is not provided');
        }
        // Clear ESC after a short delay for visual feedback
        setTimeout(() => {
          pressedKeysRef.current.delete('Escape');
          updatePressedKeysState();
        }, 200);
      }
      return;
    }

    // Only process WASD keys when in keyboard mode
    if (controlMode !== 'keyboard') {
      return;
    }

    if (!enabled) {
      return;
    }

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      event.preventDefault(); // Prevent default browser behavior
      
      // Add key to pressed set
      pressedKeysRef.current.add(event.code);
      updatePressedKeysState(); // Update state for UI
      updateMovement();
    }
  }, [enabled, controlMode, onEndSession, updateMovement, escWorksInAllModes, updatePressedKeysState]);

  // Handle keyup events
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Handle ESC key release (works in all modes if enabled)
    if (event.code === 'Escape') {
      if (escWorksInAllModes || controlMode === 'keyboard') {
        event.preventDefault();
        pressedKeysRef.current.delete('Escape');
        updatePressedKeysState();
      }
      return;
    }

    if (!enabled || controlMode !== 'keyboard') return;

    // Only process WASD keys
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      event.preventDefault();
      
      // Remove key from pressed set
      pressedKeysRef.current.delete(event.code);
      updatePressedKeysState(); // Update state for UI
      updateMovement();
    }
  }, [enabled, controlMode, updateMovement, escWorksInAllModes, updatePressedKeysState]);

  // Set up event listeners
  useEffect(() => {
    // Always listen for ESC if it should work in all modes
    const shouldListenForEsc = escWorksInAllModes || controlMode === 'keyboard';
    const shouldListenForWASD = enabled && controlMode === 'keyboard';

    // Always set up listeners if ESC should work or WASD should work
    // This allows ESC to work even when not connected, and WASD to provide visual feedback
    if (shouldListenForEsc || shouldListenForWASD) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    } else {
      // Clear pressed keys when disabled or mode changes
      pressedKeysRef.current.clear();
      setPressedKeys([]); // Empty array is fine, won't cause loop
      if (lastInputRef.current.forward !== 0 || lastInputRef.current.turn !== 0) {
        lastInputRef.current = { forward: 0, turn: 0 };
        if (onStop) {
          onStop();
        }
      }
      return;
    }

    // Handle window blur (user switches tabs/windows) - stop all movement
    const handleBlur = () => {
      pressedKeysRef.current.clear();
      setPressedKeys([]); // Empty array is fine, won't cause loop
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
      
      // Clean up on unmount
      pressedKeysRef.current.clear();
      // Don't update state in cleanup - component is unmounting anyway
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

