import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faEdit,
  faTrash,
  faToggleOn,
  faToggleOff,
  faKeyboard,
  faGamepad,
} from '@fortawesome/free-solid-svg-icons';
import { InputBindingPicker } from '../InputBindingPicker';
import { ROSCommandTerminal } from './ROSCommandTerminal';
import { CustomCommand, KeyboardBinding, GamepadBinding } from '../../types/customCommands';
import { getMockCommandsForRobot } from '../../mocks/customCommands';
import './CustomCommandsManager.css';

export interface CustomCommandsManagerProps {
  robotId: string;
  /** Callback when commands are saved */
  onSave?: (commands: CustomCommand[]) => void;
}

export function CustomCommandsManager({ robotId, onSave }: CustomCommandsManagerProps) {
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [editingCommand, setEditingCommand] = useState<CustomCommand | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (robotId) {
      const mockCommands = getMockCommandsForRobot(robotId);
      setCommands(mockCommands);
    }
  }, [robotId]);

  const handleCreate = () => {
    const newCommand: CustomCommand = {
      id: `cmd-${Date.now()}`,
      robotId,
      name: '',
      keyBinding: undefined,
      gamepadBinding: undefined,
      rosCommand: '',
      description: '',
      enabled: true,
      isDefault: false,
    };
    setEditingCommand(newCommand);
    setIsCreating(true);
  };

  const handleEdit = (command: CustomCommand) => {
    setEditingCommand({ ...command });
    setIsCreating(false);
  };

  const handleDelete = (commandId: string) => {
    if (window.confirm('Are you sure you want to delete this command?')) {
      const updated = commands.filter(cmd => cmd.id !== commandId);
      setCommands(updated);
      onSave?.(updated);
    }
  };

  const handleToggleEnabled = (commandId: string) => {
    const updated = commands.map(cmd =>
      cmd.id === commandId ? { ...cmd, enabled: !cmd.enabled } : cmd
    );
    setCommands(updated);
    onSave?.(updated);
  };

  const handleSaveCommand = () => {
    if (!editingCommand) return;

    if (!editingCommand.name.trim()) {
      alert('Please enter a command name');
      return;
    }
    if (!editingCommand.rosCommand.trim()) {
      alert('Please enter a ROS command');
      return;
    }
    if (!editingCommand.keyBinding && !editingCommand.gamepadBinding) {
      alert('Please set at least one binding (keyboard or gamepad)');
      return;
    }

    const nextCommands = isCreating
      ? [...commands, editingCommand]
      : commands.map(cmd => (cmd.id === editingCommand.id ? editingCommand : cmd));
    setCommands(nextCommands);
    onSave?.(nextCommands);

    setEditingCommand(null);
    setIsCreating(false);
  };

  const handleCancelEdit = () => {
    setEditingCommand(null);
    setIsCreating(false);
  };

  const getExistingKeyboardBindings = (excludeCommandId?: string): Set<KeyboardBinding> => {
    const bindings = new Set<KeyboardBinding>();
    commands.forEach(cmd => {
      if (cmd.id !== excludeCommandId && cmd.keyBinding) {
        bindings.add(cmd.keyBinding);
      }
    });
    return bindings;
  };

  const getExistingGamepadBindings = (excludeCommandId?: string): Set<GamepadBinding> => {
    const bindings = new Set<GamepadBinding>();
    commands.forEach(cmd => {
      if (cmd.id !== excludeCommandId && cmd.gamepadBinding) {
        bindings.add(cmd.gamepadBinding);
      }
    });
    return bindings;
  };

  const formatBinding = (binding?: string): string => {
    if (!binding) return 'Not set';
    return binding.replace(/Key/g, '').replace(/Button/g, '').replace(/Arrow/g, '');
  };

  return (
    <div className="custom-commands-manager">
      <div className="commands-header">
        <h3>Custom Commands</h3>
        <button type="button" className="create-button" onClick={handleCreate}>
          <FontAwesomeIcon icon={faPlus} />
          Add Command
        </button>
      </div>

      {editingCommand && (
        <div className="command-editor-panel">
          <h4>{isCreating ? 'Create New Command' : 'Edit Command'}</h4>
          
          <div className="editor-form">
            <div className="form-group">
              <label>Command Name *</label>
              <input
                type="text"
                value={editingCommand.name}
                onChange={(e) => setEditingCommand({ ...editingCommand, name: e.target.value })}
                placeholder="e.g., Wave Arm"
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={editingCommand.description || ''}
                onChange={(e) => setEditingCommand({ ...editingCommand, description: e.target.value })}
                placeholder="Optional description for users"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label>Input Bindings</label>
              <InputBindingPicker
                keyboardBinding={editingCommand.keyBinding}
                gamepadBinding={editingCommand.gamepadBinding}
                onBindingChange={(kb, gb) => {
                  setEditingCommand({
                    ...editingCommand,
                    keyBinding: kb,
                    gamepadBinding: gb,
                  });
                }}
                existingKeyboardBindings={getExistingKeyboardBindings(editingCommand.id)}
                existingGamepadBindings={getExistingGamepadBindings(editingCommand.id)}
              />
            </div>

            <div className="form-group">
              <label>ROS Command *</label>
              <ROSCommandTerminal
                value={editingCommand.rosCommand}
                onChange={(command) => setEditingCommand({ ...editingCommand, rosCommand: command })}
                disabled={false}
                rows={8}
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={editingCommand.enabled}
                  onChange={(e) => setEditingCommand({ ...editingCommand, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editingCommand.isDefault}
                  onChange={(e) => setEditingCommand({ ...editingCommand, isDefault: e.target.checked })}
                />
                Set as Default
              </label>
            </div>

            <div className="editor-actions">
              <button type="button" className="save-button" onClick={handleSaveCommand}>
                Save
              </button>
              <button type="button" className="cancel-button" onClick={handleCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="commands-list">
        {commands.length === 0 ? (
          <div className="empty-state">
            <p>No custom commands yet. Click "Add Command" to create one.</p>
          </div>
        ) : (
          commands.map(cmd => (
            <div key={cmd.id} className={`command-item ${!cmd.enabled ? 'disabled' : ''}`}>
              <div className="command-item-header">
                <div className="command-info">
                  <h4>{cmd.name}</h4>
                  {cmd.description && <p className="command-description">{cmd.description}</p>}
                </div>
                <div className="command-actions">
                  <button
                    type="button"
                    className="toggle-button"
                    onClick={() => handleToggleEnabled(cmd.id)}
                    title={cmd.enabled ? 'Disable' : 'Enable'}
                  >
                    <FontAwesomeIcon icon={cmd.enabled ? faToggleOn : faToggleOff} />
                  </button>
                  <button
                    type="button"
                    className="edit-button"
                    onClick={() => handleEdit(cmd)}
                    title="Edit"
                  >
                    <FontAwesomeIcon icon={faEdit} />
                  </button>
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => handleDelete(cmd.id)}
                    title="Delete"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>

              <div className="command-bindings">
                <div className="binding-info">
                  <FontAwesomeIcon icon={faKeyboard} />
                  <span>{formatBinding(cmd.keyBinding)}</span>
                </div>
                <div className="binding-info">
                  <FontAwesomeIcon icon={faGamepad} />
                  <span>{formatBinding(cmd.gamepadBinding)}</span>
                </div>
              </div>

              {cmd.isDefault && (
                <div className="default-badge">Default</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

