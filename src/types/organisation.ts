export type OrgStatus = 'active' | 'suspended' | 'denied';
export type MemberStatus = 'active' | 'suspended';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  ownerId: string;
  status: OrgStatus;
  creationCostCredits: number | null;
  maxMembers: number;
  memberCount: number;
  robotCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface OrgRole {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  priority: number;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  userEmail: string | null;
  roleId: string;
  roleName?: string;
  status: MemberStatus;
  joinedAt: string;
}

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string;
  roleId: string;
  roleName?: string;
  invitedBy: string;
  status: InviteStatus;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
}

export type RobotConnectionStatus = 'online' | 'offline' | 'error';

export interface OrgRobot {
  id: string;
  orgId: string;
  robotId: string;
  name: string;
  model: string;
  robotType: string;
  connectionStatus: RobotConnectionStatus;
  lastSeen: string | null;
  ipAddress: string | null;
  firmwareVersion: string | null;
  totalSessions: number;
  totalHours: number;
  assignedOperators: string[];
  createdAt: string;
}

export type SessionStatus = 'active' | 'completed' | 'terminated' | 'failed';
export type LogLevel = 'info' | 'warn' | 'error';

export interface OrgSession {
  id: string;
  orgId: string;
  robotId: string;
  robotName: string;
  operatorId: string;
  operatorEmail: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  creditsUsed: number | null;
}

export interface OrgLog {
  id: string;
  orgId: string;
  robotId: string;
  robotName: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  source: string;
}

export type RosCommandCategory = 'motion' | 'sensor' | 'system' | 'custom';

export interface RosCommand {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  category: RosCommandCategory;
  rosTopic: string;
  messageType: string;
  payloadTemplate: string;
  allowedRoleIds: string[];
  targetRobotIds: string[];
  isEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  lastExecutedAt: string | null;
  executionCount: number;
}

export const ROS_COMMAND_CATEGORIES: { id: RosCommandCategory; label: string }[] = [
  { id: 'motion', label: 'Motion' },
  { id: 'sensor', label: 'Sensor' },
  { id: 'system', label: 'System' },
  { id: 'custom', label: 'Custom' },
];

export type DenyReason = 'abuse' | 'safety' | 'policy' | 'other';
export type DenyScope = 'ip' | 'user' | 'device' | 'region';

export interface DenyListEntry {
  id: string;
  orgId: string;
  scope: DenyScope;
  value: string;
  reason: DenyReason;
  description: string | null;
  isActive: boolean;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string | null;
}

export const DENY_SCOPES: { id: DenyScope; label: string }[] = [
  { id: 'ip', label: 'IP Address' },
  { id: 'user', label: 'User' },
  { id: 'device', label: 'Device' },
  { id: 'region', label: 'Region' },
];

export const DENY_REASONS: { id: DenyReason; label: string }[] = [
  { id: 'abuse', label: 'Abuse' },
  { id: 'safety', label: 'Safety Violation' },
  { id: 'policy', label: 'Policy Violation' },
  { id: 'other', label: 'Other' },
];

export type NotificationType = 'alert' | 'info' | 'warning' | 'system';
export type NotificationChannel = 'in_app' | 'email' | 'webhook';
export type NotificationStatus = 'active' | 'paused';

export interface NotificationRule {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  type: NotificationType;
  event: string;
  channels: NotificationChannel[];
  targetRoleIds: string[];
  targetUserIds: string[];
  isEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
}

export interface OrgNotification {
  id: string;
  orgId: string;
  ruleId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  robotId: string | null;
  robotName: string | null;
}

export const NOTIFICATION_EVENTS: { id: string; label: string }[] = [
  { id: 'robot:disconnect', label: 'Robot Disconnected' },
  { id: 'robot:error', label: 'Robot Error' },
  { id: 'robot:battery_low', label: 'Battery Low' },
  { id: 'session:start', label: 'Session Started' },
  { id: 'session:end', label: 'Session Ended' },
  { id: 'session:fail', label: 'Session Failed' },
  { id: 'member:join', label: 'Member Joined' },
  { id: 'member:leave', label: 'Member Left' },
  { id: 'denylist:triggered', label: 'Deny List Triggered' },
  { id: 'command:executed', label: 'Command Executed' },
];

export const ORG_PERMISSIONS = [
  'members:view',
  'members:manage',
  'roles:view',
  'roles:manage',
  'robots:view',
  'robots:manage',
  'robots:operate',
  'sessions:view',
  'logs:view',
  'settings:view',
  'settings:manage',
  'commands:view',
  'commands:manage',
  'commands:execute',
  'notifications:manage',
] as const;

export type OrgPermission = typeof ORG_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<string, string> = {
  'members:view': 'View Members',
  'members:manage': 'Manage Members',
  'roles:view': 'View Roles',
  'roles:manage': 'Manage Roles',
  'robots:view': 'View Robots',
  'robots:manage': 'Manage Robots',
  'robots:operate': 'Operate Robots',
  'sessions:view': 'View Sessions',
  'logs:view': 'View Logs',
  'settings:view': 'View Settings',
  'settings:manage': 'Manage Settings',
  'commands:view': 'View Commands',
  'commands:manage': 'Manage Commands',
  'commands:execute': 'Execute Commands',
  'notifications:manage': 'Manage Notifications',
};

export type CustomizationSubTab = 'ros-commands' | 'controller' | 'locations' | 'keyboard';

export interface ControllerConfig {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  controllerType: 'gamepad' | 'joystick' | 'custom';
  axisMapping: Record<string, string>;
  buttonMapping: Record<string, string>;
  deadzone: number;
  sensitivity: number;
  targetRobotIds: string[];
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
}

export interface LocationMapping {
  id: string;
  orgId: string;
  name: string;
  label: string;
  description: string | null;
  coordinates: { x: number; y: number; z: number };
  mapId: string | null;
  floorLevel: number;
  zone: string | null;
  targetRobotIds: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface KeyboardMapping {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  bindings: Record<string, string>;
  modifiers: Record<string, string>;
  targetRobotIds: string[];
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
}

export type CommandHQTab =
  | 'overview'
  | 'members'
  | 'roles'
  | 'robots'
  | 'sessions'
  | 'customizations'
  | 'denylist'
  | 'notifications'
  | 'settings';
