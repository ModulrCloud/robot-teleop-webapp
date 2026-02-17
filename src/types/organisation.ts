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

export type CommandHQTab =
  | 'overview'
  | 'members'
  | 'roles'
  | 'robots'
  | 'sessions'
  | 'commands'
  | 'denylist'
  | 'notifications'
  | 'settings';
