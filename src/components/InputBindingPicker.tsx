import { useState, useEffect, useCallback, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faKeyboard,
  faGamepad,
  faExclamationTriangle,
  faCheckCircle,
} from '@fortawesome/free-solid-svg-icons';
import {
  InputMethod,
  KeyboardBinding,
  GamepadBinding,
  GamepadButton,
  GAMEPAD_BUTTON_NAMES,
  GAMEPAD_BUTTON_BINDINGS,
  RESERVED_KEYBOARD_KEYS,
  RESERVED_GAMEPAD_BUTTONS,
} from '../types/customCommands';
import './InputBindingPicker.css';

export interface InputBindingPickerProps {
  keyboardBinding?: KeyboardBinding;
  gamepadBinding?: GamepadBinding;
  onBindingChange: (keyboard?: KeyboardBinding, gamepad?: GamepadBinding) => void;
  existingKeyboardBindings?: Set<KeyboardBinding>;
  existingGamepadBindings?: Set<GamepadBinding>;
  allowBoth?: boolean;
  disabled?: boolean;
}

const MODIFIER_ONLY_KEYS = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export function InputBindingPicker({
  keyboardBinding,
  gamepadBinding,
  onBindingChange,
  existingKeyboardBindings = new Set(),
  existingGamepadBindings = new Set(),
  allowBoth = true,
  disabled = false,
}: InputBindingPickerProps) {
  const [activeTab, setActiveTab] = useState<InputMethod>('keyboard');
  const [isListening, setIsListening] = useState(false);
  const [conflict, setConflict] = useState<{ type: InputMethod; binding: string } | null>(null);
  const [lastPressedKey, setLastPressedKey] = useState<string | null>(null);
  const [lastPressedButton, setLastPressedButton] = useState<GamepadButton | null>(null);
  const gamepadPollRef = useRef<number | null>(null);
  const previousButtonStatesRef = useRef<boolean[]>([]);

  useEffect(() => {
    if (!isListening || activeTab !== 'keyboard' || disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' || e.code === 'Escape') {
        setIsListening(false);
        setConflict(null);
        return;
      }

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.altKey) modifiers.push('Alt');
      if (e.metaKey) modifiers.push('Meta');

      const key = e.code || e.key;
      if (MODIFIER_ONLY_KEYS.has(key)) {
        return;
      }
      const binding: KeyboardBinding = modifiers.length > 0
        ? `${modifiers.join('+')}+${key}`
        : key;

      setLastPressedKey(binding);

      if (RESERVED_KEYBOARD_KEYS.has(key)) {
        setConflict({ type: 'keyboard', binding: `${key} is reserved for system controls` });
        return;
      }

      if (existingKeyboardBindings.has(binding) && binding !== keyboardBinding) {
        setConflict({ type: 'keyboard', binding: `${binding} is already in use` });
        return;
      }

      setConflict(null);
      setIsListening(false);
      onBindingChange(binding, gamepadBinding);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isListening, activeTab, keyboardBinding, gamepadBinding, existingKeyboardBindings, onBindingChange, disabled]);

  useEffect(() => {
    if (!isListening || activeTab !== 'gamepad' || disabled) return;

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads();
      const gamepad = gamepads[0];

      if (!gamepad) {
        gamepadPollRef.current = requestAnimationFrame(pollGamepad);
        return;
      }

      if (previousButtonStatesRef.current.length === 0) {
        previousButtonStatesRef.current = new Array(gamepad.buttons.length).fill(false);
      }

      for (let i = 0; i < gamepad.buttons.length; i++) {
        const isPressed = gamepad.buttons[i].pressed;
        const wasPressed = previousButtonStatesRef.current[i];

        if (isPressed && !wasPressed) {
          const button = i as GamepadButton;
          const binding = GAMEPAD_BUTTON_BINDINGS[button] || `Button${i}`;

          setLastPressedButton(button);

          if (RESERVED_GAMEPAD_BUTTONS.has(binding)) {
            setConflict({ type: 'gamepad', binding: `${GAMEPAD_BUTTON_NAMES[button]} is reserved` });
            previousButtonStatesRef.current[i] = isPressed;
            gamepadPollRef.current = requestAnimationFrame(pollGamepad);
            return;
          }

          if (existingGamepadBindings.has(binding) && binding !== gamepadBinding) {
            setConflict({ type: 'gamepad', binding: `${GAMEPAD_BUTTON_NAMES[button]} is already in use` });
            previousButtonStatesRef.current[i] = isPressed;
            gamepadPollRef.current = requestAnimationFrame(pollGamepad);
            return;
          }

          setConflict(null);
          setIsListening(false);
          onBindingChange(keyboardBinding, binding);
          previousButtonStatesRef.current = new Array(gamepad.buttons.length).fill(false);
          return;
        }

        previousButtonStatesRef.current[i] = isPressed;
      }

      gamepadPollRef.current = requestAnimationFrame(pollGamepad);
    };

    gamepadPollRef.current = requestAnimationFrame(pollGamepad);

    return () => {
      if (gamepadPollRef.current) {
        cancelAnimationFrame(gamepadPollRef.current);
        gamepadPollRef.current = null;
      }
      previousButtonStatesRef.current = [];
    };
  }, [isListening, activeTab, keyboardBinding, gamepadBinding, existingGamepadBindings, onBindingChange, disabled]);

  useEffect(() => {
    if (!allowBoth && activeTab !== 'keyboard') {
      setActiveTab('keyboard');
    }
  }, [allowBoth, activeTab]);

  const handleStartListening = useCallback(() => {
    setConflict(null);
    setLastPressedKey(null);
    setLastPressedButton(null);
    setIsListening(true);
  }, []);

  const handleStopListening = useCallback(() => {
    setIsListening(false);
    setConflict(null);
  }, []);

  const handleClearBinding = useCallback((type: InputMethod) => {
    if (type === 'keyboard') {
      onBindingChange(undefined, gamepadBinding);
    } else {
      onBindingChange(keyboardBinding, undefined);
    }
    setConflict(null);
  }, [keyboardBinding, gamepadBinding, onBindingChange]);

  const formatKeyboardBinding = (binding?: KeyboardBinding): string => {
    if (!binding) return 'Not set';
    return binding.replace(/Key/g, '').replace(/Arrow/g, '');
  };

  const formatGamepadBinding = (binding?: GamepadBinding): string => {
    if (!binding) return 'Not set';
    const buttonIndex = parseInt(binding.replace('Button', ''));
    const button = buttonIndex as GamepadButton;
    return GAMEPAD_BUTTON_NAMES[button] || binding;
  };

  return (
    <div className="input-binding-picker">
      {allowBoth && (
        <div className="binding-tabs">
          <button
            type="button"
            className={`tab ${activeTab === 'keyboard' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('keyboard');
              setIsListening(false);
              setConflict(null);
            }}
            disabled={disabled}
          >
            <FontAwesomeIcon icon={faKeyboard} />
            <span>Keyboard</span>
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'gamepad' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('gamepad');
              setIsListening(false);
              setConflict(null);
            }}
            disabled={disabled}
          >
            <FontAwesomeIcon icon={faGamepad} />
            <span>Gamepad</span>
          </button>
        </div>
      )}

      {activeTab === 'keyboard' && (
        <div className="binding-picker-content">
          <div className="current-binding">
            <label>Current Binding:</label>
            <div className="binding-display">
              <code>{formatKeyboardBinding(keyboardBinding)}</code>
              {keyboardBinding && (
                <button
                  type="button"
                  className="clear-button"
                  onClick={() => handleClearBinding('keyboard')}
                  disabled={disabled}
                  title="Clear binding"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {!isListening ? (
            <button
              type="button"
              className="listen-button"
              onClick={handleStartListening}
              disabled={disabled}
            >
              {keyboardBinding ? 'Change Binding' : 'Set Binding'}
            </button>
          ) : (
            <div className="listening-state">
              <p className="listening-text">
                Press any key combination...
                {lastPressedKey && <span className="pressed-key"> ({lastPressedKey})</span>}
              </p>
              <button
                type="button"
                className="cancel-button"
                onClick={handleStopListening}
              >
                Cancel
              </button>
            </div>
          )}

          {conflict && conflict.type === 'keyboard' && (
            <div className="conflict-warning">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>{conflict.binding}</span>
            </div>
          )}

          {keyboardBinding && !conflict && (
            <div className="binding-success">
              <FontAwesomeIcon icon={faCheckCircle} />
              <span>Binding set successfully</span>
            </div>
          )}

          <div className="binding-hints">
            <p className="hint-title">Tips:</p>
            <ul>
              <li>Use modifier keys (Ctrl, Shift, Alt) for more options</li>
              <li>WASD and Escape are reserved for movement and session control</li>
              <li>Press Escape to cancel while listening</li>
            </ul>
          </div>
        </div>
      )}

      {allowBoth && activeTab === 'gamepad' && (
        <div className="binding-picker-content">
          <div className="current-binding">
            <label>Current Binding:</label>
            <div className="binding-display">
              <code>{formatGamepadBinding(gamepadBinding)}</code>
              {gamepadBinding && (
                <button
                  type="button"
                  className="clear-button"
                  onClick={() => handleClearBinding('gamepad')}
                  disabled={disabled}
                  title="Clear binding"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {!isListening ? (
            <button
              type="button"
              className="listen-button"
              onClick={handleStartListening}
              disabled={disabled}
            >
              {gamepadBinding ? 'Change Binding' : 'Set Binding'}
            </button>
          ) : (
            <div className="listening-state">
              <p className="listening-text">
                Press any gamepad button...
                {lastPressedButton !== null && (
                  <span className="pressed-key">
                    {' '}({GAMEPAD_BUTTON_NAMES[lastPressedButton]})
                  </span>
                )}
              </p>
              <button
                type="button"
                className="cancel-button"
                onClick={handleStopListening}
              >
                Cancel
              </button>
            </div>
          )}

          {conflict && conflict.type === 'gamepad' && (
            <div className="conflict-warning">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>{conflict.binding}</span>
            </div>
          )}

          {gamepadBinding && !conflict && (
            <div className="binding-success">
              <FontAwesomeIcon icon={faCheckCircle} />
              <span>Binding set successfully</span>
            </div>
          )}

          <div className="gamepad-layout">
            <div className="gamepad-visual">
              <div className="gamepad-top">
                <div className="gamepad-button-group">
                  <div className="gamepad-button-label">LB</div>
                  <div className="gamepad-button-label">RB</div>
                </div>
              </div>
              <div className="gamepad-middle">
                <div className="gamepad-left">
                  <div className="gamepad-stick-area">
                    <div className="gamepad-stick"></div>
                    <div className="gamepad-stick-label">L3</div>
                  </div>
                  <div className="gamepad-dpad">
                    <div className="dpad-up">↑</div>
                    <div className="dpad-center">
                      <div className="dpad-left">←</div>
                      <div className="dpad-right">→</div>
                    </div>
                    <div className="dpad-down">↓</div>
                  </div>
                </div>
                <div className="gamepad-right">
                  <div className="gamepad-buttons">
                    <div className="gamepad-button y-button">Y</div>
                    <div className="gamepad-button x-button">X</div>
                    <div className="gamepad-button a-button">A</div>
                    <div className="gamepad-button b-button">B</div>
                  </div>
                  <div className="gamepad-stick-area">
                    <div className="gamepad-stick"></div>
                    <div className="gamepad-stick-label">R3</div>
                  </div>
                </div>
              </div>
              <div className="gamepad-bottom">
                <div className="gamepad-button-label">Select</div>
                <div className="gamepad-button-label">Start</div>
              </div>
            </div>
          </div>

          <div className="binding-hints">
            <p className="hint-title">Available Buttons:</p>
            <ul>
              <li>A, B, X, Y - Face buttons</li>
              <li>LB, RB - Shoulder buttons</li>
              <li>LT, RT - Triggers</li>
              <li>D-Pad - Directional pad</li>
              <li>L3, R3 - Stick presses</li>
              <li>Select, Start - System buttons</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

