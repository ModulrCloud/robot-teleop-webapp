import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faKeyboard,
  faGamepad,
  faTimes,
  faEdit,
  faCheck,
  faUndo,
} from '@fortawesome/free-solid-svg-icons';
import { InputBindingPicker } from './InputBindingPicker';
import { CustomCommand, KeyboardBinding, GamepadBinding } from '../types/customCommands';
import { getEnabledMockCommandsForRobot } from '../mocks/customCommands';
import './InputBindingsModal.css';

export interface InputBindingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  robotId: string;
  /** Client's custom bindings (overrides) */
  clientBindings?: {
    keyboard: Record<KeyboardBinding, string>;
    gamepad: Record<GamepadBinding, string>;
  };
  /** Callback when client saves their custom bindings */
  onSaveClientBindings?: (bindings: {
    keyboard: Record<KeyboardBinding, string>;
    gamepad: Record<GamepadBinding, string>;
  }) => void;
}

export function InputBindingsModal({
  isOpen,
  onClose,
  robotId,
  clientBindings,
  onSaveClientBindings,
}: InputBindingsModalProps) {
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'keyboard' | 'gamepad'>('keyboard');
  const [tempBindings, setTempBindings] = useState<Record<string, {
    keyboard?: KeyboardBinding;
    gamepad?: GamepadBinding;
  }>>({});

  // Load commands for this robot
  useEffect(() => {
    if (isOpen && robotId) {
      const mockCommands = getEnabledMockCommandsForRobot(robotId);
      setCommands(mockCommands);
      
      // Initialize temp bindings with current values (client overrides or partner defaults)
      const initial: Record<string, { keyboard?: KeyboardBinding; gamepad?: GamepadBinding }> = {};
      mockCommands.forEach(cmd => {
        initial[cmd.id] = {
          keyboard: clientBindings?.keyboard && Object.entries(clientBindings.keyboard).find(([_, id]) => id === cmd.id)?.[0] as KeyboardBinding || cmd.keyBinding,
          gamepad: clientBindings?.gamepad && Object.entries(clientBindings.gamepad).find(([_, id]) => id === cmd.id)?.[0] as GamepadBinding || cmd.gamepadBinding,
        };
      });
      setTempBindings(initial);
    }
  }, [isOpen, robotId, clientBindings]);

  if (!isOpen) return null;

  const handleStartEdit = (commandId: string) => {
    setEditingCommandId(commandId);
  };

  const handleCancelEdit = (commandId: string) => {
    setEditingCommandId(null);
    // Reset to original values
    const cmd = commands.find(c => c.id === commandId);
    if (cmd) {
      setTempBindings(prev => ({
        ...prev,
        [commandId]: {
          keyboard: clientBindings?.keyboard && Object.entries(clientBindings.keyboard).find(([_, id]) => id === commandId)?.[0] as KeyboardBinding || cmd.keyBinding,
          gamepad: clientBindings?.gamepad && Object.entries(clientBindings.gamepad).find(([_, id]) => id === commandId)?.[0] as GamepadBinding || cmd.gamepadBinding,
        },
      }));
    }
  };

  const handleSaveEdit = (_commandId: string) => {
    setEditingCommandId(null);
    // In real implementation, this would save to backend
    // For now, just update local state
    if (onSaveClientBindings) {
      const keyboard: Record<KeyboardBinding, string> = {};
      const gamepad: Record<GamepadBinding, string> = {};
      
      commands.forEach(cmd => {
        const binding = tempBindings[cmd.id];
        if (binding?.keyboard) {
          keyboard[binding.keyboard] = cmd.id;
        }
        if (binding?.gamepad) {
          gamepad[binding.gamepad] = cmd.id;
        }
      });
      
      onSaveClientBindings({ keyboard, gamepad });
    }
  };

  const handleResetToDefaults = () => {
    const reset: Record<string, { keyboard?: KeyboardBinding; gamepad?: GamepadBinding }> = {};
    commands.forEach(cmd => {
      reset[cmd.id] = {
        keyboard: cmd.keyBinding,
        gamepad: cmd.gamepadBinding,
      };
    });
    setTempBindings(reset);
    setEditingCommandId(null);
  };

  const getExistingKeyboardBindings = (excludeCommandId?: string): Set<KeyboardBinding> => {
    const bindings = new Set<KeyboardBinding>();
    commands.forEach(cmd => {
      if (cmd.id !== excludeCommandId) {
        const binding = tempBindings[cmd.id]?.keyboard || cmd.keyBinding;
        if (binding) bindings.add(binding);
      }
    });
    return bindings;
  };

  const getExistingGamepadBindings = (excludeCommandId?: string): Set<GamepadBinding> => {
    const bindings = new Set<GamepadBinding>();
    commands.forEach(cmd => {
      if (cmd.id !== excludeCommandId) {
        const binding = tempBindings[cmd.id]?.gamepad || cmd.gamepadBinding;
        if (binding) bindings.add(binding);
      }
    });
    return bindings;
  };

  const formatBinding = (binding?: string): string => {
    if (!binding) return 'Not set';
    return binding.replace(/Key/g, '').replace(/Button/g, '').replace(/Arrow/g, '');
  };

  return (
    <div className="input-bindings-modal-overlay" onClick={onClose}>
      <div className="input-bindings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="input-bindings-modal-header">
          <h2>
            <FontAwesomeIcon icon={faKeyboard} />
            <FontAwesomeIcon icon={faGamepad} />
            Input Bindings
          </h2>
          <button className="input-bindings-close-button" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="input-bindings-modal-content">
          {/* Tabs */}
          <div className="bindings-tabs">
            <button
              className={`tab-button ${activeTab === 'keyboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('keyboard')}
            >
              <FontAwesomeIcon icon={faKeyboard} />
              Keyboard
            </button>
            <button
              className={`tab-button ${activeTab === 'gamepad' ? 'active' : ''}`}
              onClick={() => setActiveTab('gamepad')}
            >
              <FontAwesomeIcon icon={faGamepad} />
              Controller
            </button>
          </div>

          <div className="modal-body">
            {commands.length === 0 ? (
              <div className="empty-state">
                <p>No custom commands available for this robot.</p>
              </div>
            ) : (
            <>
              <div className="bindings-header">
                <p className="bindings-description">
                  View and customize key bindings for custom commands. Your changes will be saved for future sessions.
                </p>
                <button className="reset-button" onClick={handleResetToDefaults}>
                  <FontAwesomeIcon icon={faUndo} />
                  Reset to Defaults
                </button>
              </div>

              <div className="bindings-list">
                {commands.map(cmd => {
                  const isEditing = editingCommandId === cmd.id;
                  const currentBindings = tempBindings[cmd.id] || {};

                  return (
                    <div key={cmd.id} className={`binding-item ${isEditing ? 'editing' : ''}`}>
                      <div className="binding-item-header">
                        <div className="command-info">
                          <h3>{cmd.name}</h3>
                          {cmd.description && (
                            <p className="command-description">{cmd.description}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <button
                            className="edit-binding-button"
                            onClick={() => handleStartEdit(cmd.id)}
                          >
                            <FontAwesomeIcon icon={faEdit} />
                            Edit
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="binding-editor">
                          <InputBindingPicker
                            keyboardBinding={currentBindings.keyboard}
                            gamepadBinding={currentBindings.gamepad}
                            onBindingChange={(kb, gb) => {
                              setTempBindings(prev => ({
                                ...prev,
                                [cmd.id]: { keyboard: kb, gamepad: gb },
                              }));
                            }}
                            existingKeyboardBindings={getExistingKeyboardBindings(cmd.id)}
                            existingGamepadBindings={getExistingGamepadBindings(cmd.id)}
                          />
                          <div className="binding-actions">
                            <button
                              className="save-button"
                              onClick={() => handleSaveEdit(cmd.id)}
                            >
                              <FontAwesomeIcon icon={faCheck} />
                              Save
                            </button>
                            <button
                              className="cancel-button"
                              onClick={() => handleCancelEdit(cmd.id)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="binding-display">
                          <div className="binding-row">
                            <div className="binding-label">
                              <FontAwesomeIcon icon={faKeyboard} />
                              <span>Keyboard:</span>
                            </div>
                            <code>{formatBinding(currentBindings.keyboard || cmd.keyBinding)}</code>
                          </div>
                          <div className="binding-row">
                            <div className="binding-label">
                              <FontAwesomeIcon icon={faGamepad} />
                              <span>Gamepad:</span>
                            </div>
                            <code>{formatBinding(currentBindings.gamepad || cmd.gamepadBinding)}</code>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
            )}
          </div>

          {/* Footer with Save Button */}
          <div className="modal-footer">
            <button
              className="save-all-button"
              onClick={() => {
                if (commands.length > 0 && editingCommandId) {
                  handleSaveEdit(editingCommandId);
                }
                if (onSaveClientBindings && commands.length > 0) {
                  const keyboard: Record<KeyboardBinding, string> = {} as any;
                  const gamepad: Record<GamepadBinding, string> = {} as any;
                  
                  commands.forEach(cmd => {
                    const binding = tempBindings[cmd.id];
                    if (binding?.keyboard) {
                      keyboard[binding.keyboard] = cmd.id;
                    }
                    if (binding?.gamepad) {
                      gamepad[binding.gamepad] = cmd.id;
                    }
                  });
                  
                  onSaveClientBindings({ keyboard, gamepad });
                }
                onClose();
              }}
            >
              <FontAwesomeIcon icon={faCheck} />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

