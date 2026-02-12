import type { Organisation, OrgRole, OrgMember, OrgInvite, OrgRobot } from '../types/organisation';

export const MOCK_ROLES: OrgRole[] = [
  {
    id: 'role-owner',
    orgId: 'org-001',
    name: 'Owner',
    description: 'Full control. Cannot be removed.',
    permissions: ['*'],
    isSystem: true,
    priority: 0,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'role-admin',
    orgId: 'org-001',
    name: 'Admin',
    description: 'Manage members, roles, robots, and settings.',
    permissions: [
      'members:view', 'members:manage',
      'roles:view', 'roles:manage',
      'robots:view', 'robots:manage',
      'sessions:view', 'logs:view',
      'settings:view', 'settings:manage',
      'commands:view', 'commands:manage',
      'notifications:manage',
    ],
    isSystem: true,
    priority: 1,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'role-operator',
    orgId: 'org-001',
    name: 'Operator',
    description: 'Operate robots and view sessions.',
    permissions: [
      'members:view',
      'robots:view', 'robots:operate',
      'sessions:view',
      'commands:view', 'commands:execute',
    ],
    isSystem: true,
    priority: 2,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'role-viewer',
    orgId: 'org-001',
    name: 'Viewer',
    description: 'Read-only access to the organisation.',
    permissions: ['members:view', 'robots:view', 'sessions:view', 'logs:view'],
    isSystem: true,
    priority: 3,
    createdAt: '2026-01-15T10:00:00Z',
  },
];

export const MOCK_MEMBERS: OrgMember[] = [
  {
    id: 'mem-001',
    orgId: 'org-001',
    userId: 'user-abc123',
    userEmail: 'ken@modulr.cloud',
    roleId: 'role-owner',
    roleName: 'Owner',
    status: 'active',
    joinedAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'mem-002',
    orgId: 'org-001',
    userId: 'user-def456',
    userEmail: 'alex@modulr.cloud',
    roleId: 'role-admin',
    roleName: 'Admin',
    status: 'active',
    joinedAt: '2026-01-20T14:30:00Z',
  },
  {
    id: 'mem-003',
    orgId: 'org-001',
    userId: 'user-ghi789',
    userEmail: 'jordan@example.com',
    roleId: 'role-operator',
    roleName: 'Operator',
    status: 'active',
    joinedAt: '2026-02-01T09:00:00Z',
  },
];

export const MOCK_INVITES: OrgInvite[] = [
  {
    id: 'inv-001',
    orgId: 'org-001',
    email: 'newuser@example.com',
    roleId: 'role-viewer',
    roleName: 'Viewer',
    invitedBy: 'user-abc123',
    status: 'pending',
    inviteCode: 'abc123def456',
    expiresAt: '2026-02-20T10:00:00Z',
    createdAt: '2026-02-13T10:00:00Z',
  },
];

export const MOCK_ROBOTS: OrgRobot[] = [
  {
    id: 'robot-001',
    orgId: 'org-001',
    robotId: 'spot-alpha',
    name: 'Spot Alpha',
    model: 'Spot',
    robotType: 'Quadruped',
    connectionStatus: 'online',
    lastSeen: '2026-02-10T14:30:00Z',
    ipAddress: '192.168.1.101',
    firmwareVersion: '3.2.1',
    totalSessions: 47,
    totalHours: 128.5,
    assignedOperators: ['user-abc123', 'user-ghi789'],
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'robot-002',
    orgId: 'org-001',
    robotId: 'arm-beta',
    name: 'Arm Beta',
    model: 'UR5e',
    robotType: 'Arm',
    connectionStatus: 'online',
    lastSeen: '2026-02-10T14:28:00Z',
    ipAddress: '192.168.1.102',
    firmwareVersion: '5.11.4',
    totalSessions: 83,
    totalHours: 312.0,
    assignedOperators: ['user-def456'],
    createdAt: '2026-01-18T08:00:00Z',
  },
  {
    id: 'robot-003',
    orgId: 'org-001',
    robotId: 'drone-gamma',
    name: 'Drone Gamma',
    model: 'M300 RTK',
    robotType: 'Aerial',
    connectionStatus: 'offline',
    lastSeen: '2026-02-08T17:45:00Z',
    ipAddress: null,
    firmwareVersion: '02.01.0501',
    totalSessions: 21,
    totalHours: 36.2,
    assignedOperators: ['user-abc123'],
    createdAt: '2026-01-22T11:00:00Z',
  },
  {
    id: 'robot-004',
    orgId: 'org-001',
    robotId: 'rover-delta',
    name: 'Rover Delta',
    model: 'Husky A200',
    robotType: 'UGV',
    connectionStatus: 'error',
    lastSeen: '2026-02-09T09:12:00Z',
    ipAddress: '192.168.1.104',
    firmwareVersion: '1.4.0',
    totalSessions: 12,
    totalHours: 18.7,
    assignedOperators: [],
    createdAt: '2026-02-01T14:00:00Z',
  },
];

export const MOCK_ORGANISATIONS: Organisation[] = [
  {
    id: 'org-001',
    name: 'Modulr Robotics',
    slug: 'modulr-robotics',
    description: 'Building the future of robot teleoperation',
    logoUrl: null,
    ownerId: 'user-abc123',
    status: 'active',
    creationCostCredits: 500,
    maxMembers: 10,
    memberCount: 3,
    robotCount: 4,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-05T16:00:00Z',
  },
  {
    id: 'org-002',
    name: 'Drone Ops Inc',
    slug: 'drone-ops',
    description: 'Industrial drone fleet management',
    logoUrl: null,
    ownerId: 'user-abc123',
    status: 'active',
    creationCostCredits: 500,
    maxMembers: 5,
    memberCount: 1,
    robotCount: 2,
    createdAt: '2026-02-01T12:00:00Z',
    updatedAt: null,
  },
];

export function getMockOrgsForUser(): Organisation[] {
  return MOCK_ORGANISATIONS;
}

export function getMockOrgById(orgId: string): Organisation | undefined {
  return MOCK_ORGANISATIONS.find((o) => o.id === orgId);
}

export function getMockRolesForOrg(orgId: string): OrgRole[] {
  return MOCK_ROLES.filter((r) => r.orgId === orgId);
}

export function getMockMembersForOrg(orgId: string): OrgMember[] {
  return MOCK_MEMBERS.filter((m) => m.orgId === orgId);
}

export function getMockInvitesForOrg(orgId: string): OrgInvite[] {
  return MOCK_INVITES.filter((i) => i.orgId === orgId);
}

export function getMockRobotsForOrg(orgId: string): OrgRobot[] {
  return MOCK_ROBOTS.filter((r) => r.orgId === orgId);
}
