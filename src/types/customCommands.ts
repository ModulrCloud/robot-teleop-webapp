/**
 * Type definitions for custom ROS commands with input bindings
 */

export type InputMethod = 'keyboard' | 'gamepad';

/**
 * Keyboard binding format
 * Examples: "KeyW", "Ctrl+KeyA", "Shift+Space", "Alt+KeyF"
 */
export type KeyboardBinding = string;

/**
 * Gamepad button binding format
 * Examples: "Button0", "Button4", "DPadUp", "LeftTrigger", "RightTrigger"
 */
export type GamepadBinding = string;

/**
 * Standard gamepad button indices
 */
export enum GamepadButton {
  A = 0,
  B = 1,
  X = 2,
  Y = 3,
  LeftBumper = 4,
  RightBumper = 5,
  LeftTrigger = 6,
  RightTrigger = 7,
  Select = 8,
  Start = 9,
  LeftStick = 10,
  RightStick = 11,
  DPadUp = 12,
  DPadDown = 13,
  DPadLeft = 14,
  DPadRight = 15,
}

/**
 * Human-readable gamepad button names
 */
export const GAMEPAD_BUTTON_NAMES: Record<GamepadButton, string> = {
  [GamepadButton.A]: 'A',
  [GamepadButton.B]: 'B',
  [GamepadButton.X]: 'X',
  [GamepadButton.Y]: 'Y',
  [GamepadButton.LeftBumper]: 'LB',
  [GamepadButton.RightBumper]: 'RB',
  [GamepadButton.LeftTrigger]: 'LT',
  [GamepadButton.RightTrigger]: 'RT',
  [GamepadButton.Select]: 'Select',
  [GamepadButton.Start]: 'Start',
  [GamepadButton.LeftStick]: 'L3',
  [GamepadButton.RightStick]: 'R3',
  [GamepadButton.DPadUp]: 'D-Pad Up',
  [GamepadButton.DPadDown]: 'D-Pad Down',
  [GamepadButton.DPadLeft]: 'D-Pad Left',
  [GamepadButton.DPadRight]: 'D-Pad Right',
};

/**
 * Gamepad button binding string format
 */
export const GAMEPAD_BUTTON_BINDINGS: Record<GamepadButton, GamepadBinding> = {
  [GamepadButton.A]: 'Button0',
  [GamepadButton.B]: 'Button1',
  [GamepadButton.X]: 'Button2',
  [GamepadButton.Y]: 'Button3',
  [GamepadButton.LeftBumper]: 'Button4',
  [GamepadButton.RightBumper]: 'Button5',
  [GamepadButton.LeftTrigger]: 'Button6',
  [GamepadButton.RightTrigger]: 'Button7',
  [GamepadButton.Select]: 'Button8',
  [GamepadButton.Start]: 'Button9',
  [GamepadButton.LeftStick]: 'Button10',
  [GamepadButton.RightStick]: 'Button11',
  [GamepadButton.DPadUp]: 'Button12',
  [GamepadButton.DPadDown]: 'Button13',
  [GamepadButton.DPadLeft]: 'Button14',
  [GamepadButton.DPadRight]: 'Button15',
};

/**
 * Custom ROS command definition
 */
export interface CustomCommand {
  id: string;
  robotId: string;
  name: string;
  keyBinding?: KeyboardBinding; // Optional keyboard binding
  gamepadBinding?: GamepadBinding; // Optional gamepad binding
  rosCommand: string; // ROS command JSON string
  description?: string;
  enabled: boolean;
  isDefault: boolean; // Partner's default binding
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Client's custom input binding preferences (overrides partner defaults)
 */
export interface ClientInputBindings {
  userId: string;
  robotId: string;
  keyboardBindings: Record<KeyboardBinding, string>; // key binding -> commandId
  gamepadBindings: Record<GamepadBinding, string>; // gamepad binding -> commandId
}

/**
 * System keys that are reserved and cannot be used for custom commands
 */
export const RESERVED_KEYBOARD_KEYS: Set<string> = new Set([
  'KeyW', // Forward
  'KeyA', // Turn left
  'KeyS', // Backward
  'KeyD', // Turn right
  'Escape', // End session
  'Enter', // Common system key
  'Tab', // Navigation
]);

/**
 * System gamepad buttons that are reserved (analog sticks for movement)
 * Note: Buttons 0-15 can potentially be used, but we reserve sticks for movement
 */
export const RESERVED_GAMEPAD_BUTTONS: Set<GamepadBinding> = new Set([
  // Analog sticks are reserved for movement (axes, not buttons)
  // But we might want to reserve stick presses if they're used for something
]);

