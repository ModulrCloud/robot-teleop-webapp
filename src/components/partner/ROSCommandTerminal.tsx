import { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCode,
  faCheckCircle,
  faExclamationTriangle,
  faInfoCircle,
  faChevronDown,
  faChevronUp,
  faSync,
} from '@fortawesome/free-solid-svg-icons';
import { parseROS2Command, convertToCustomCommandFormat } from '../../utils/rosCommandParser';
import './ROSCommandTerminal.css';

export interface ROSCommandTerminalProps {
  /** Current ROS command JSON string */
  value: string;
  /** Callback when command changes */
  onChange: (command: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Number of rows */
  rows?: number;
}

/**
 * Example ROS commands for quick reference
 */
const EXAMPLE_COMMANDS = [
  {
    name: 'Simple String Command',
    description: 'Send a string message to a ROS topic',
    command: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'example-command',
      rosTopic: '/arm_controller/command',
      rosMessageType: 'std_msgs/String',
      payload: {
        data: 'wave',
      },
    }, null, 2),
  },
  {
    name: 'Boolean Command',
    description: 'Toggle a boolean value',
    command: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'toggle-lights',
      rosTopic: '/lights/toggle',
      rosMessageType: 'std_msgs/Bool',
      payload: {
        data: true,
      },
    }, null, 2),
  },
  {
    name: 'Numeric Command',
    description: 'Set a numeric value',
    command: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'set-speed',
      rosTopic: '/robot/speed',
      rosMessageType: 'std_msgs/Float32',
      payload: {
        data: 0.5,
      },
    }, null, 2),
  },
  {
    name: 'Complex Message (Twist)',
    description: 'Send a geometry_msgs/Twist command',
    command: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'precise-movement',
      rosTopic: '/cmd_vel',
      rosMessageType: 'geometry_msgs/Twist',
      payload: {
        linear: {
          x: 0.2,
          y: 0.0,
          z: 0.0,
        },
        angular: {
          x: 0.0,
          y: 0.0,
          z: 0.0,
        },
      },
    }, null, 2),
  },
  {
    name: 'Command Group (Sequence)',
    description: 'Execute multiple commands in sequence',
    command: JSON.stringify({
      type: 'CustomCommandGroup',
      commandId: 'inspection-routine',
      commands: [
        {
          rosTopic: '/camera/pan',
          rosMessageType: 'std_msgs/Float32',
          payload: { data: 45.0 },
          delay: 1000,
        },
        {
          rosTopic: '/camera/tilt',
          rosMessageType: 'std_msgs/Float32',
          payload: { data: -30.0 },
          delay: 500,
        },
        {
          rosTopic: '/camera/capture',
          rosMessageType: 'std_msgs/Bool',
          payload: { data: true },
          delay: 0,
        },
      ],
    }, null, 2),
  },
  {
    name: 'Unitree API Request',
    description: 'Example: Converting ros2 topic pub command to JSON format',
    command: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'unitree-sport-request',
      rosTopic: '/api/sport/request',
      rosMessageType: 'unitree_api/msg/Request',
      payload: {
        header: {
          identity: { id: 1, api_id: 2047 },
          lease: { id: 0 },
          policy: { priority: 0, noreply: false },
        },
        parameter: '',
        binary: [],
      },
    }, null, 2),
  },
];

export function ROSCommandTerminal({
  value,
  onChange,
  placeholder = 'Enter ROS command as JSON...',
  disabled = false,
  rows = 8,
}: ROSCommandTerminalProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [isROS2Command, setIsROS2Command] = useState(false);
  const [convertedCommand, setConvertedCommand] = useState<string | null>(null);
  const [_showConverted, setShowConverted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Validate and parse input (either ROS2 CLI or JSON)
  useEffect(() => {
    if (!value || value.trim() === '') {
      setValidationError(null);
      setPreview(null);
      setIsROS2Command(false);
      setConvertedCommand(null);
      setShowConverted(false);
      return;
    }

    // First, check if it's a ROS2 CLI command
    const ros2Parsed = parseROS2Command(value);
    if (ros2Parsed) {
      setIsROS2Command(true);
      
      if (ros2Parsed.isValid) {
        // Convert to our format
        try {
          const converted = convertToCustomCommandFormat(ros2Parsed);
          setConvertedCommand(converted);
          setValidationError(null);
          
          // Parse the converted JSON for preview
          const parsed = JSON.parse(converted);
          setPreview(parsed);
        } catch (error) {
          setValidationError(error instanceof Error ? error.message : 'Failed to convert ROS2 command');
          setPreview(null);
          setConvertedCommand(null);
        }
      } else {
        setValidationError(ros2Parsed.error || 'Invalid ROS2 command format');
        setPreview(null);
        setConvertedCommand(null);
      }
      return;
    }

    // Not a ROS2 command, try parsing as JSON
    setIsROS2Command(false);
    setConvertedCommand(null);
    
    try {
      const parsed = JSON.parse(value);
      
      // Validate it has the expected structure
      if (typeof parsed !== 'object' || parsed === null) {
        setValidationError('Command must be a JSON object');
        setPreview(null);
        return;
      }

      // Check for required fields (for CustomCommand)
      if (parsed.type === 'CustomCommand') {
        if (!parsed.rosTopic || !parsed.rosMessageType || !parsed.payload) {
          setValidationError('CustomCommand requires: type, rosTopic, rosMessageType, and payload');
          setPreview(null);
          return;
        }
      } else if (parsed.type === 'CustomCommandGroup') {
        if (!Array.isArray(parsed.commands)) {
          setValidationError('CustomCommandGroup requires: type and commands array');
          setPreview(null);
          return;
        }
      } else if (!parsed.type) {
        // If no type specified, assume it's a CustomCommand and warn
        setValidationError('Warning: Missing "type" field. Should be "CustomCommand" or "CustomCommandGroup"');
        // Don't return - allow preview to show
      }

      setValidationError(null);
      setPreview(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setValidationError(`JSON Syntax Error: ${error.message}`);
        setPreview(null);
      } else {
        setValidationError('Invalid JSON format');
        setPreview(null);
      }
    }
  }, [value]);

  // Don't auto-replace - keep the original ROS command, just show preview

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleExampleSelect = (example: typeof EXAMPLE_COMMANDS[0]) => {
    onChange(example.command);
    setShowExamples(false);
    // Focus the textarea after a brief delay
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  const formatPreview = (obj: any, indent = 0): string => {
    if (obj === null) return 'null';
    if (typeof obj === 'string') return `"${obj}"`;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) {
      return `[\n${obj.map(item => '  '.repeat(indent + 1) + formatPreview(item, indent + 1)).join(',\n')}\n${'  '.repeat(indent)}]`;
    }
    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      return `{\n${entries.map(([key, val]) => 
        '  '.repeat(indent + 1) + `"${key}": ${formatPreview(val, indent + 1)}`
      ).join(',\n')}\n${'  '.repeat(indent)}}`;
    }
    return String(obj);
  };

  return (
    <div className="ros-command-terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <FontAwesomeIcon icon={faCode} />
          <span>ROS Command</span>
        </div>
        <button
          type="button"
          className="examples-toggle"
          onClick={() => setShowExamples(!showExamples)}
          disabled={disabled}
        >
          <FontAwesomeIcon icon={showExamples ? faChevronUp : faChevronDown} />
          <span>Examples</span>
        </button>
      </div>

      {showExamples && (
        <div className="examples-panel">
          <p className="examples-description">
            Select an example to use as a starting point:
          </p>
          <div className="examples-list">
            {EXAMPLE_COMMANDS.map((example, index) => (
              <button
                key={index}
                type="button"
                className="example-item"
                onClick={() => handleExampleSelect(example)}
                disabled={disabled}
              >
                <div className="example-header">
                  <strong>{example.name}</strong>
                </div>
                <div className="example-description">{example.description}</div>
                <div className="example-preview">
                  <code>{example.command.substring(0, 100)}...</code>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="terminal-container">
        <div className="terminal-prompt">
          <span>$</span>
        </div>
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            className={`terminal-input ${validationError ? 'error' : ''} ${preview ? 'valid' : ''} ${value ? 'has-content' : ''}`}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            spellCheck={false}
          />
          {!value && (
            <span className="textarea-cursor-blink">_</span>
          )}
        </div>
      </div>

      {isROS2Command && convertedCommand && (
        <div className="conversion-notice">
          <FontAwesomeIcon icon={faSync} />
          <span>ROS2 command detected - JSON conversion preview below</span>
        </div>
      )}

      {validationError && (
        <div className="validation-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          <div className="error-content">
            <strong>JSON Error:</strong>
            <span>{validationError}</span>
          </div>
        </div>
      )}

      {!isROS2Command && preview && !validationError && (
        <div className="validation-success">
          <FontAwesomeIcon icon={faCheckCircle} />
          <span>Valid JSON</span>
        </div>
      )}

      {isROS2Command && convertedCommand && !validationError && (
        <div className="command-preview">
          <div className="preview-header">
            <FontAwesomeIcon icon={faInfoCircle} />
            <span>JSON Conversion Preview (what will be sent to robot):</span>
          </div>
          <div className="preview-content">
            <pre>{convertedCommand}</pre>
          </div>
        </div>
      )}

      {!isROS2Command && preview && !validationError && (
        <div className="command-preview">
          <div className="preview-header">
            <FontAwesomeIcon icon={faInfoCircle} />
            <span>Preview: What will be sent to robot</span>
          </div>
          <div className="preview-content">
            <pre>{formatPreview(preview)}</pre>
          </div>
        </div>
      )}

      <div className="terminal-hints">
        <p className="hint-title">Tips:</p>
        <ul>
          <li>Use valid JSON format</li>
          <li>Required fields: <code>type</code>, <code>rosTopic</code>, <code>rosMessageType</code>, <code>payload</code></li>
          <li>For command groups, use <code>type: "CustomCommandGroup"</code> with <code>commands</code> array</li>
          <li>See examples above for common patterns</li>
        </ul>
      </div>
    </div>
  );
}

