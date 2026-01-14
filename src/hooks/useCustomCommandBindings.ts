import { useEffect, useRef, useCallback } from 'react';
import { CustomCommand, KeyboardBinding, GamepadBinding, RESERVED_KEYBOARD_KEYS } from '../types/customCommands';
import { getEnabledMockCommandsForRobot } from '../mocks/customCommands';
import { logger } from '../utils/logger';

export interface CustomCommandExecutionResult {
  commandId: string;
  commandName: string;
  inputMethod: 'keyboard' | 'gamepad';
  success: boolean;
  error?: string;
}

export interface UseCustomCommandBindingsOptions {
  robotId: string;
  enabled?: boolean;
  onCommandExecute?: (result: CustomCommandExecutionResult) => void;
  /** Client's custom keyboard bindings (overrides) */
  clientKeyboardBindings?: Record<KeyboardBinding, string>; // binding -> commandId
  /** Client's custom gamepad bindings (overrides) */
  clientGamepadBindings?: Record<GamepadBinding, string>; // binding -> commandId
}

/**
 * Hook to handle custom command bindings for keyboard and gamepad input
 * 
 * This hook:
 * - Listens for keyboard key presses and matches them to custom command bindings
 * - Polls gamepad buttons and detects button presses
 * - Executes commands when bindings are matched (mock execution for now)
 * - Handles modifier keys (Ctrl, Shift, Alt)
 * - Supports all standard gamepad buttons including triggers and D-pad
 */
export function useCustomCommandBindings({
  robotId,
  enabled = true,
  onCommandExecute,
  clientKeyboardBindings,
  clientGamepadBindings,
}: UseCustomCommandBindingsOptions) {
  const commandsRef = useRef<CustomCommand[]>([]);
  const keyboardBindingMapRef = useRef<Map<KeyboardBinding, CustomCommand>>(new Map());
  const gamepadBindingMapRef = useRef<Map<GamepadBinding, CustomCommand>>(new Map());
  const lastGamepadStateRef = useRef<boolean[]>([]);
  const animationFrameRef = useRef<number>(0);
  const lastExecutionTimeRef = useRef<Map<string, number>>(new Map());
  const throttleMs = 200; // Minimum time between command executions (per command)

  // Load commands and build binding maps
  const updateBindings = useCallback(() => {
    if (!robotId) return;

    // Load enabled commands for this robot
    const commands = getEnabledMockCommandsForRobot(robotId);
    commandsRef.current = commands;

    // Build keyboard binding map (client overrides take precedence)
    const keyboardMap = new Map<KeyboardBinding, CustomCommand>();
    commands.forEach(cmd => {
      // Check if client has an override for this command
      const clientBinding = clientKeyboardBindings 
        ? Object.entries(clientKeyboardBindings).find(([_, id]) => id === cmd.id)?.[0]
        : null;
      
      const binding = clientBinding || cmd.keyBinding;
      if (binding) {
        keyboardMap.set(binding, cmd);
      }
    });
    keyboardBindingMapRef.current = keyboardMap;

    // Build gamepad binding map (client overrides take precedence)
    const gamepadMap = new Map<GamepadBinding, CustomCommand>();
    commands.forEach(cmd => {
      // Check if client has an override for this command
      const clientBinding = clientGamepadBindings
        ? Object.entries(clientGamepadBindings).find(([_, id]) => id === cmd.id)?.[0]
        : null;
      
      const binding = clientBinding || cmd.gamepadBinding;
      if (binding) {
        gamepadMap.set(binding, cmd);
      }
    });
    gamepadBindingMapRef.current = gamepadMap;

    logger.log(`[CUSTOM_COMMANDS] Loaded ${commands.length} commands for robot ${robotId}`);
  }, [robotId, clientKeyboardBindings, clientGamepadBindings]);

  // Execute a command (mock execution for now)
  const executeCommand = useCallback((
    command: CustomCommand,
    inputMethod: 'keyboard' | 'gamepad'
  ) => {
    const now = Date.now();
    const lastExecution = lastExecutionTimeRef.current.get(command.id) || 0;
    
    // Throttle rapid executions
    if (now - lastExecution < throttleMs) {
      return;
    }
    
    lastExecutionTimeRef.current.set(command.id, now);

    logger.log(`[CUSTOM_COMMANDS] Executing command: ${command.name} (${inputMethod})`);

    // Mock execution - in Phase 4, this will send via WebRTC
    const result: CustomCommandExecutionResult = {
      commandId: command.id,
      commandName: command.name,
      inputMethod,
      success: true,
    };

    if (onCommandExecute) {
      onCommandExecute(result);
    }
  }, [onCommandExecute, throttleMs]);

  // Parse keyboard binding string to check if it matches current key press
  const matchesKeyboardBinding = useCallback((
    binding: KeyboardBinding,
    event: KeyboardEvent
  ): boolean => {
    // Parse binding (e.g., "Ctrl+KeyA", "Shift+Space", "KeyW")
    const parts = binding.split('+');
    const keyPart = parts[parts.length - 1]; // Last part is the key
    const modifiers = parts.slice(0, -1); // Everything before last part

    // Check if the key matches
    if (event.code !== keyPart) {
      return false;
    }

    // Check modifiers
    const hasCtrl = modifiers.includes('Ctrl') || modifiers.includes('Control');
    const hasShift = modifiers.includes('Shift');
    const hasAlt = modifiers.includes('Alt');

    if (hasCtrl && !event.ctrlKey) return false;
    if (hasShift && !event.shiftKey) return false;
    if (hasAlt && !event.altKey) return false;

    // Ensure no extra modifiers are pressed
    if (!hasCtrl && event.ctrlKey) return false;
    if (!hasShift && event.shiftKey) return false;
    if (!hasAlt && event.altKey) return false;

    return true;
  }, []);

  // Handle keyboard events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Skip reserved keys (WASD, Escape, etc.) - these are for movement/system controls
    // We only process custom command bindings, not system keys
    if (RESERVED_KEYBOARD_KEYS.has(event.code)) {
      return; // Let the movement/system controls handle these
    }

    // Check all keyboard bindings
    for (const [binding, command] of keyboardBindingMapRef.current.entries()) {
      if (matchesKeyboardBinding(binding, event)) {
        event.preventDefault(); // Prevent default behavior for bound keys
        executeCommand(command, 'keyboard');
        break; // Only execute one command per key press
      }
    }
  }, [enabled, matchesKeyboardBinding, executeCommand]);

  // Convert gamepad button index to binding string
  const getGamepadBindingFromButton = useCallback((buttonIndex: number): GamepadBinding | null => {
    // Check if it's a standard button (0-11)
    if (buttonIndex >= 0 && buttonIndex <= 11) {
      return `Button${buttonIndex}`;
    }
    
    // Check if it's a D-pad button (12-15)
    if (buttonIndex === 12) return 'Button12'; // DPadUp
    if (buttonIndex === 13) return 'Button13'; // DPadDown
    if (buttonIndex === 14) return 'Button14'; // DPadLeft
    if (buttonIndex === 15) return 'Button15'; // DPadRight

    return null;
  }, []);

  // Poll gamepad buttons
  const pollGamepad = useCallback(() => {
    if (!enabled) return;

    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0]; // Use first connected gamepad

    if (!gamepad) {
      lastGamepadStateRef.current = [];
      return;
    }

    // Initialize last state if needed
    if (lastGamepadStateRef.current.length === 0) {
      lastGamepadStateRef.current = new Array(gamepad.buttons.length).fill(false);
    }

    // Check each button for state changes
    for (let i = 0; i < gamepad.buttons.length; i++) {
      const button = gamepad.buttons[i];
      const wasPressed = lastGamepadStateRef.current[i] || false;
      const isPressed = button.pressed;

      // Detect button press (state change from false to true)
      if (!wasPressed && isPressed) {
        // For analog triggers (6, 7), check if value exceeds threshold
        if (i === 6 || i === 7) {
          const threshold = 0.5; // Trigger threshold
          if (button.value < threshold) {
            continue; // Trigger not pressed enough
          }
        }

        const binding = getGamepadBindingFromButton(i);
        if (binding) {
          const command = gamepadBindingMapRef.current.get(binding);
          if (command) {
            executeCommand(command, 'gamepad');
          }
        }
      }

      // Update last state
      lastGamepadStateRef.current[i] = isPressed;
    }

    animationFrameRef.current = requestAnimationFrame(pollGamepad);
  }, [enabled, getGamepadBindingFromButton, executeCommand]);

  // Initialize bindings
  useEffect(() => {
    updateBindings();
  }, [updateBindings]);

  // Set up keyboard event listener
  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  // Set up gamepad polling
  useEffect(() => {
    if (!enabled) return;

    if (!('getGamepads' in navigator)) {
      logger.warn('[CUSTOM_COMMANDS] Gamepad API not supported');
      return;
    }

    animationFrameRef.current = requestAnimationFrame(pollGamepad);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled, pollGamepad]);

  // Return utility functions for external use
  return {
    commands: commandsRef.current,
    executeCommand: (commandId: string, inputMethod: 'keyboard' | 'gamepad') => {
      const command = commandsRef.current.find(cmd => cmd.id === commandId);
      if (command) {
        executeCommand(command, inputMethod);
      }
    },
  };
}

