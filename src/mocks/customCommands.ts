/**
 * Mock data for custom commands - used for UI development and testing
 */

import { CustomCommand } from '../types/customCommands';

/**
 * Sample custom commands for different robot types
 */
export const MOCK_CUSTOM_COMMANDS: CustomCommand[] = [
  {
    id: 'cmd-001',
    robotId: 'robot1',
    name: 'Wave Arm',
    keyBinding: 'KeyQ',
    gamepadBinding: 'Button0', // A button
    rosCommand: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'wave-arm-001',
      rosTopic: '/arm_controller/command',
      rosMessageType: 'std_msgs/String',
      payload: { data: 'wave' },
    }),
    description: 'Makes the robot wave its arm',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'cmd-002',
    robotId: 'robot1',
    name: 'Toggle Lights',
    keyBinding: 'KeyL',
    gamepadBinding: 'Button1', // B button
    rosCommand: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'toggle-lights',
      rosTopic: '/lights/toggle',
      rosMessageType: 'std_msgs/Bool',
      payload: { data: true },
    }),
    description: 'Toggles the robot\'s lights on/off',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'cmd-003',
    robotId: 'robot1',
    name: 'Camera Pan Left',
    keyBinding: 'Ctrl+ArrowLeft',
    gamepadBinding: 'Button14', // D-Pad Left
    rosCommand: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'camera-pan-left',
      rosTopic: '/camera/pan',
      rosMessageType: 'std_msgs/Float32',
      payload: { data: -45.0 },
    }),
    description: 'Pans the camera 45 degrees to the left',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'cmd-004',
    robotId: 'robot1',
    name: 'Emergency Stop',
    keyBinding: 'KeyE',
    gamepadBinding: 'Button9', // Start button
    rosCommand: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'emergency-stop',
      rosTopic: '/emergency/stop',
      rosMessageType: 'std_msgs/Bool',
      payload: { data: true },
    }),
    description: 'Emergency stop - halts all robot movement',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'cmd-005',
    robotId: 'robot1',
    name: 'Take Photo',
    keyBinding: 'KeyP',
    gamepadBinding: 'Button2', // X button
    rosCommand: JSON.stringify({
      type: 'CustomCommand',
      commandId: 'take-photo',
      rosTopic: '/camera/capture',
      rosMessageType: 'std_msgs/Bool',
      payload: { data: true },
    }),
    description: 'Captures a photo with the robot\'s camera',
    enabled: true,
    isDefault: false,
  },
  {
    id: 'cmd-006',
    robotId: 'robot1',
    name: 'Inspection Routine',
    keyBinding: 'KeyI',
    gamepadBinding: 'Button3', // Y button
    rosCommand: JSON.stringify({
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
    }),
    description: 'Runs a complete inspection routine: pan, tilt, and capture',
    enabled: true,
    isDefault: true,
  },
];

/**
 * Get mock commands for a specific robot
 */
export function getMockCommandsForRobot(robotId: string): CustomCommand[] {
  return MOCK_CUSTOM_COMMANDS.filter(cmd => cmd.robotId === robotId);
}

/**
 * Get all enabled mock commands for a robot
 */
export function getEnabledMockCommandsForRobot(robotId: string): CustomCommand[] {
  return MOCK_CUSTOM_COMMANDS.filter(cmd => cmd.robotId === robotId && cmd.enabled);
}

