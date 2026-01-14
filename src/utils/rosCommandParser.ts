/**
 * Parser to convert ROS2 CLI commands to our JSON format
 */

export interface ParsedROSCommand {
  rosTopic: string;
  rosMessageType: string;
  payload: any;
  isValid: boolean;
  error?: string;
}

/**
 * Parses a ROS2 CLI command and converts it to our JSON format
 * 
 * Example input:
 * ros2 topic pub --once /api/sport/request unitree_api/msg/Request "{
 *   header: { identity: {id: 1, api_id: 2047},
 *             lease: {id: 0},
 *             policy: {priority: 0, noreply: false} },
 *   parameter: '',
 *   binary: []
 * }"
 */
export function parseROS2Command(input: string): ParsedROSCommand | null {
  const trimmed = input.trim();
  
  // Check if it looks like a ROS2 CLI command
  if (!trimmed.startsWith('ros2 topic pub') && !trimmed.startsWith('ros topic pub')) {
    return null; // Not a ROS2 CLI command
  }

  try {
    // Extract topic, message type, and payload
    // Pattern: ros2 topic pub [--once] <topic> <message_type> "<payload>"
    const match = trimmed.match(/ros2?\s+topic\s+pub\s+(?:--once\s+)?([^\s]+)\s+([^\s]+)\s+(.+)/s);
    
    if (!match) {
      return {
        rosTopic: '',
        rosMessageType: '',
        payload: {},
        isValid: false,
        error: 'Could not parse ROS2 command. Expected format: ros2 topic pub <topic> <message_type> "<payload>"',
      };
    }

    const [, topic, messageType, payloadStr] = match;

    // Parse the payload - it might be JSON or YAML-like format
    let payload: any;
    let payloadStrCleaned = payloadStr.trim();
    
    // Remove outer quotes if present (handle multiline strings)
    if ((payloadStrCleaned.startsWith('"') && payloadStrCleaned.endsWith('"')) || 
        (payloadStrCleaned.startsWith("'") && payloadStrCleaned.endsWith("'"))) {
      payloadStrCleaned = payloadStrCleaned.slice(1, -1);
    }
    
    try {
      // Try parsing as JSON first
      payload = JSON.parse(payloadStrCleaned);
    } catch {
      // If JSON fails, try to convert YAML-like format to JSON
      // This handles cases like: { id: 1, name: "test" } instead of {"id": 1, "name": "test"}
      try {
        let jsonStr = payloadStrCleaned;
        
        // Step 1: Replace unquoted keys with quoted keys
        // Match pattern: {key: or ,key: or [key: (but not inside strings)
        // This regex handles keys at the start of objects, after commas, and in arrays
        jsonStr = jsonStr.replace(/([{,\[]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:');
        
        // Step 2: Handle empty strings: '' -> ""
        jsonStr = jsonStr.replace(/:\s*''/g, ': ""');
        
        // Step 3: Replace single quotes with double quotes (but preserve escaped quotes)
        // First, temporarily escape any escaped single quotes
        jsonStr = jsonStr.replace(/\\'/g, '___ESCAPED_SINGLE_QUOTE___');
        jsonStr = jsonStr.replace(/'/g, '"');
        jsonStr = jsonStr.replace(/___ESCAPED_SINGLE_QUOTE___/g, "\\'");
        
        // Step 4: Handle null, true, false (don't quote them)
        jsonStr = jsonStr.replace(/:\s*null\b/g, ': null');
        jsonStr = jsonStr.replace(/:\s*true\b/g, ': true');
        jsonStr = jsonStr.replace(/:\s*false\b/g, ': false');
        
        // Step 5: Handle numeric values (don't quote them)
        // Numbers are already unquoted, so we just need to ensure they're valid
        
        payload = JSON.parse(jsonStr);
      } catch (e) {
        return {
          rosTopic: topic,
          rosMessageType: messageType,
          payload: {},
          isValid: false,
          error: `Could not parse payload. Make sure it's valid JSON or YAML format. Error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    return {
      rosTopic: topic,
      rosMessageType: messageType,
      payload,
      isValid: true,
    };
  } catch (error) {
    return {
      rosTopic: '',
      rosMessageType: '',
      payload: {},
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error parsing ROS2 command',
    };
  }
}

/**
 * Converts a parsed ROS2 command to our JSON format
 */
export function convertToCustomCommandFormat(
  parsed: ParsedROSCommand,
  commandId?: string
): string {
  if (!parsed.isValid) {
    throw new Error(parsed.error || 'Invalid parsed command');
  }

  const command = {
    type: 'CustomCommand',
    commandId: commandId || `command-${Date.now()}`,
    rosTopic: parsed.rosTopic,
    rosMessageType: parsed.rosMessageType,
    payload: parsed.payload,
  };

  return JSON.stringify(command, null, 2);
}

