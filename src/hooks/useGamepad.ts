import { useEffect, useRef, useCallback } from 'react';

export interface GamepadInput {
  forward: number;
  turn: number;
}

export function useGamepad(
  onInput: (input: GamepadInput) => void,
  enabled: boolean = true
) {
  const animationFrameRef = useRef<number>(0);
  const lastInputRef = useRef({ forward: 0, turn: 0 });

  const pollGamepad = useCallback(() => {
    if (!enabled) return;

    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0];

    if (gamepad) {
      const forward = -gamepad.axes[1] || 0;
      const turn = gamepad.axes[0] || 0;

      const deadZone = 0.15;
      const forwardFiltered = Math.abs(forward) > deadZone ? forward : 0;
      const turnFiltered = Math.abs(turn) > deadZone ? turn : 0;

      if (
        forwardFiltered !== lastInputRef.current.forward ||
        turnFiltered !== lastInputRef.current.turn
      ) {
        lastInputRef.current = { forward: forwardFiltered, turn: turnFiltered };
        onInput({ forward: forwardFiltered, turn: turnFiltered });
      }
    }

    animationFrameRef.current = requestAnimationFrame(pollGamepad);
  }, [enabled, onInput]);

  useEffect(() => {
    if (!enabled) return;

    if (!('getGamepads' in navigator)) {
      console.warn('Gamepad API not supported');
      return;
    }

    animationFrameRef.current = requestAnimationFrame(pollGamepad);

    const handleGamepadConnected = (e: GamepadEvent) => {
      console.log('Gamepad connected:', e.gamepad.id);
    };

    const handleGamepadDisconnected = (e: GamepadEvent) => {
      console.log('Gamepad disconnected:', e.gamepad.id);
      lastInputRef.current = { forward: 0, turn: 0 };
      onInput({ forward: 0, turn: 0 });
    };

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [enabled, pollGamepad]);
}
