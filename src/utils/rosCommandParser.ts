export interface ParsedROSCommand {
  rosTopic: string;
  rosMessageType: string;
  payload: unknown;
  isValid: boolean;
  error?: string;
}

export function parseROS2Command(input: string): ParsedROSCommand | null {
  const trimmed = input.trim();
  
  if (!trimmed.startsWith('ros2 topic pub') && !trimmed.startsWith('ros topic pub')) {
    return null;
  }

  try {
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

    let payload: unknown;
    let payloadStrCleaned = payloadStr.trim();
    
    if ((payloadStrCleaned.startsWith('"') && payloadStrCleaned.endsWith('"')) || 
        (payloadStrCleaned.startsWith("'") && payloadStrCleaned.endsWith("'"))) {
      payloadStrCleaned = payloadStrCleaned.slice(1, -1);
    }
    
    try {
      payload = JSON.parse(payloadStrCleaned);
    } catch {
      try {
        let jsonStr = payloadStrCleaned;
        
        jsonStr = jsonStr.replace(/([{,\[]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:');
        
        jsonStr = jsonStr.replace(/:\s*''/g, ': ""');
        
        jsonStr = jsonStr.replace(/\\'/g, '___ESCAPED_SINGLE_QUOTE___');
        jsonStr = jsonStr.replace(/'/g, '"');
        jsonStr = jsonStr.replace(/___ESCAPED_SINGLE_QUOTE___/g, "\\'");
        
        jsonStr = jsonStr.replace(/:\s*null\b/g, ': null');
        jsonStr = jsonStr.replace(/:\s*true\b/g, ': true');
        jsonStr = jsonStr.replace(/:\s*false\b/g, ': false');
        
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

