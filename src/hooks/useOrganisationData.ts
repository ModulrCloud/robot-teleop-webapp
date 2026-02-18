import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import type {
  Organisation,
  OrgRole,
  OrgMember,
  OrgInvite,
  OrgRobot,
  OrgSession,
  OrgLog,
  RosCommand,
  DenyListEntry,
  NotificationRule,
  OrgNotification,
} from '../types/organisation';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

type AmplifyRecord = Record<string, unknown>;

function mapOrg(r: AmplifyRecord): Organisation {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: (r.description as string) || null,
    logoUrl: (r.logoUrl as string) || null,
    ownerId: r.ownerId as string,
    status: (r.status as Organisation['status']) || 'active',
    creationCostCredits: (r.creationCostCredits as number) || null,
    maxMembers: (r.maxMembers as number) || 10,
    memberCount: 0,
    robotCount: 0,
    createdAt: r.createdAt as string,
    updatedAt: (r.updatedAt as string) || null,
  };
}

function mapRole(r: AmplifyRecord): OrgRole {
  let perms: string[] = [];
  if (typeof r.permissions === 'string') {
    try { perms = JSON.parse(r.permissions); } catch { perms = []; }
  } else if (Array.isArray(r.permissions)) {
    perms = r.permissions as string[];
  }
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    name: r.name as string,
    description: (r.description as string) || null,
    permissions: perms,
    isSystem: (r.isSystem as boolean) || false,
    priority: (r.priority as number) ?? 99,
    createdAt: r.createdAt as string,
  };
}

function mapMember(r: AmplifyRecord, roles: OrgRole[]): OrgMember {
  const roleId = r.roleId as string;
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    userId: r.userId as string,
    userEmail: (r.userEmail as string) || null,
    roleId,
    roleName: roles.find(rl => rl.id === roleId)?.name,
    status: (r.status as OrgMember['status']) || 'active',
    joinedAt: r.joinedAt as string,
  };
}

function mapInvite(r: AmplifyRecord, roles: OrgRole[]): OrgInvite {
  const roleId = r.roleId as string;
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    email: r.email as string,
    roleId,
    roleName: roles.find(rl => rl.id === roleId)?.name,
    invitedBy: r.invitedBy as string,
    status: (r.status as OrgInvite['status']) || 'pending',
    inviteCode: r.inviteCode as string,
    expiresAt: r.expiresAt as string,
    createdAt: r.createdAt as string,
  };
}

function mapRobot(r: AmplifyRecord): OrgRobot {
  return {
    id: r.id as string,
    orgId: (r.orgId as string) || '',
    robotId: (r.robotId as string) || '',
    name: r.name as string,
    model: (r.model as string) || '',
    robotType: (r.robotType as string) || '',
    connectionStatus: 'offline',
    lastSeen: null,
    ipAddress: null,
    firmwareVersion: null,
    totalSessions: 0,
    totalHours: 0,
    assignedOperators: [],
    createdAt: (r.createdAt as string) || '',
  };
}

function mapSession(r: AmplifyRecord): OrgSession {
  const started = r.startedAt as string;
  const ended = (r.endedAt as string) || null;
  let durationMinutes: number | null = null;
  if (started && ended) {
    durationMinutes = Math.round((new Date(ended).getTime() - new Date(started).getTime()) / 60000);
  }
  return {
    id: r.id as string,
    orgId: (r.orgId as string) || '',
    robotId: r.robotId as string,
    robotName: (r.robotName as string) || '',
    operatorId: r.userId as string,
    operatorEmail: (r.userEmail as string) || '',
    status: (r.status as OrgSession['status']) || 'completed',
    startedAt: started,
    endedAt: ended,
    durationMinutes,
    creditsUsed: (r.creditsCharged as number) || null,
  };
}

function mapLog(r: AmplifyRecord): OrgLog {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    robotId: (r.robotId as string) || '',
    robotName: (r.robotName as string) || '',
    level: (r.level as OrgLog['level']) || 'info',
    message: r.message as string,
    timestamp: r.timestamp as string,
    source: (r.source as string) || '',
  };
}

function mapCommand(r: AmplifyRecord): RosCommand {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    name: r.name as string,
    description: (r.description as string) || null,
    category: (r.category as RosCommand['category']) || 'custom',
    rosTopic: r.rosTopic as string,
    messageType: r.messageType as string,
    payloadTemplate: r.payloadTemplate as string,
    allowedRoleIds: (r.allowedRoleIds as string[]) || [],
    targetRobotIds: (r.targetRobotIds as string[]) || [],
    isEnabled: r.isEnabled !== false,
    createdBy: r.createdBy as string,
    createdAt: r.createdAt as string,
    updatedAt: (r.updatedAt as string) || null,
    lastExecutedAt: (r.lastExecutedAt as string) || null,
    executionCount: (r.executionCount as number) || 0,
  };
}

function mapDenyEntry(r: AmplifyRecord): DenyListEntry {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    scope: (r.scope as DenyListEntry['scope']) || 'ip',
    value: r.value as string,
    reason: (r.reason as DenyListEntry['reason']) || 'other',
    description: (r.description as string) || null,
    isActive: r.isActive !== false,
    createdBy: r.createdBy as string,
    createdByEmail: (r.createdByEmail as string) || '',
    createdAt: r.createdAt as string,
    expiresAt: (r.expiresAt as string) || null,
  };
}

function mapNotifRule(r: AmplifyRecord): NotificationRule {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    name: r.name as string,
    description: (r.description as string) || null,
    type: (r.type as NotificationRule['type']) || 'info',
    event: r.event as string,
    channels: (r.channels as NotificationRule['channels']) || [],
    targetRoleIds: (r.targetRoleIds as string[]) || [],
    targetUserIds: (r.targetUserIds as string[]) || [],
    isEnabled: r.isEnabled !== false,
    createdBy: r.createdBy as string,
    createdAt: r.createdAt as string,
    updatedAt: (r.updatedAt as string) || null,
    lastTriggeredAt: (r.lastTriggeredAt as string) || null,
    triggerCount: (r.triggerCount as number) || 0,
  };
}

function mapNotification(r: AmplifyRecord): OrgNotification {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    ruleId: (r.ruleId as string) || null,
    type: (r.type as OrgNotification['type']) || 'info',
    title: r.title as string,
    message: r.message as string,
    isRead: (r.isRead as boolean) || false,
    createdAt: r.createdAt as string,
    robotId: (r.robotId as string) || null,
    robotName: (r.robotName as string) || null,
  };
}

interface OrgData {
  org: Organisation | null;
  roles: OrgRole[];
  members: OrgMember[];
  invites: OrgInvite[];
  robots: OrgRobot[];
  sessions: OrgSession[];
  logs: OrgLog[];
  commands: RosCommand[];
  denyList: DenyListEntry[];
  notifRules: NotificationRule[];
  notifications: OrgNotification[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOrganisationData(orgId: string | undefined): OrgData {
  const [org, setOrg] = useState<Organisation | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [robots, setRobots] = useState<OrgRobot[]>([]);
  const [sessions, setSessions] = useState<OrgSession[]>([]);
  const [logs, setLogs] = useState<OrgLog[]>([]);
  const [commands, setCommands] = useState<RosCommand[]>([]);
  const [denyList, setDenyList] = useState<DenyListEntry[]>([]);
  const [notifRules, setNotifRules] = useState<NotificationRule[]>([]);
  const [notifications, setNotifications] = useState<OrgNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    try {
      const orgResult = await client.models.Organisation.get({ id: orgId });
      if (!orgResult.data) {
        setError('Organisation not found');
        setLoading(false);
        return;
      }
      const orgData = mapOrg(orgResult.data as unknown as AmplifyRecord);

      const orgFilter = { filter: { orgId: { eq: orgId } } };

      const [rolesRes, membersRes, invitesRes, robotsRes, sessionsRes, logsRes, cmdsRes, denyRes, rulesRes, notifsRes] = await Promise.all([
        client.models.OrgRole.list(orgFilter),
        client.models.OrgMember.list(orgFilter),
        client.models.OrgInvite.list(orgFilter),
        client.models.Robot.list({ filter: { orgId: { eq: orgId } } }),
        client.models.Session.list({ filter: { orgId: { eq: orgId } } }),
        client.models.OrgLog.list(orgFilter),
        client.models.RosCommand.list(orgFilter),
        client.models.DenyListEntry.list(orgFilter),
        client.models.NotificationRule.list(orgFilter),
        client.models.OrgNotification.list(orgFilter),
      ]);

      const safe = <T,>(res: { data?: T[] | null; errors?: unknown[] }) => {
        if (res.errors?.length) {
          logger.warn('useOrganisationData partial errors:', JSON.stringify(res.errors).slice(0, 500));
        }
        return (res.data || []).filter(Boolean) as NonNullable<T>[];
      };

      const mappedRoles = safe(rolesRes).map(r => mapRole(r as unknown as AmplifyRecord));
      const mappedMembers = safe(membersRes).map(r => mapMember(r as unknown as AmplifyRecord, mappedRoles));
      const mappedInvites = safe(invitesRes).map(r => mapInvite(r as unknown as AmplifyRecord, mappedRoles));
      const mappedRobots = safe(robotsRes).map(r => mapRobot(r as unknown as AmplifyRecord));
      const mappedSessions = safe(sessionsRes).map(r => mapSession(r as unknown as AmplifyRecord));
      const mappedLogs = safe(logsRes).map(r => mapLog(r as unknown as AmplifyRecord));
      const mappedCmds = safe(cmdsRes).map(r => mapCommand(r as unknown as AmplifyRecord));
      const mappedDeny = safe(denyRes).map(r => mapDenyEntry(r as unknown as AmplifyRecord));
      const mappedRules = safe(rulesRes).map(r => mapNotifRule(r as unknown as AmplifyRecord));
      const mappedNotifs = safe(notifsRes).map(r => mapNotification(r as unknown as AmplifyRecord));

      // Enrich robot data with operator assignments
      const robotOperatorPromises = mappedRobots.map(async (robot) => {
        if (!robot.robotId) return robot;
        try {
          const opsRes = await client.models.RobotOperator.list({
            filter: { robotId: { eq: robot.robotId } },
          });
          return {
            ...robot,
            assignedOperators: (opsRes.data || []).map(op => (op as unknown as AmplifyRecord).operatorUserId as string),
          };
        } catch {
          return robot;
        }
      });
      const enrichedRobots = await Promise.all(robotOperatorPromises);

      orgData.memberCount = mappedMembers.length;
      orgData.robotCount = enrichedRobots.length;

      setOrg(orgData);
      setRoles(mappedRoles);
      setMembers(mappedMembers);
      setInvites(mappedInvites);
      setRobots(enrichedRobots);
      setSessions(mappedSessions);
      setLogs(mappedLogs);
      setCommands(mappedCmds);
      setDenyList(mappedDeny);
      setNotifRules(mappedRules);
      setNotifications(mappedNotifs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err) || 'Failed to load organisation data';
      logger.error('useOrganisationData error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { org, roles, members, invites, robots, sessions, logs, commands, denyList, notifRules, notifications, loading, error, refetch: fetchData };
}

export async function fetchUserOrganisations(userId: string): Promise<Organisation[]> {
  try {
    logger.log('fetchUserOrganisations: querying for userId =', userId);

    const ownedRes = await client.models.Organisation.list({
      filter: { ownerId: { eq: userId } },
    });

    if (ownedRes.errors?.length) {
      logger.error('fetchUserOrganisations: Organisation.list errors:', JSON.stringify(ownedRes.errors, null, 2));
    }

    logger.log('fetchUserOrganisations: owned orgs count =', ownedRes.data?.length ?? 0);

    const memberRes = await client.models.OrgMember.list({
      filter: { userId: { eq: userId } },
    });

    if (memberRes.errors?.length) {
      logger.warn('fetchUserOrganisations: OrgMember.list partial errors (createdAt/updatedAt may be null):', memberRes.errors.length, 'errors');
    }
    logger.log('fetchUserOrganisations: member records count =', memberRes.data?.length ?? 0);

    const orgMap = new Map<string, Organisation>();

    for (const r of (ownedRes.data || [])) {
      const org = mapOrg(r as unknown as AmplifyRecord);
      orgMap.set(org.id, org);
    }

    const memberOrgIds = (memberRes.data || [])
      .filter(Boolean)
      .map(m => (m as unknown as AmplifyRecord).orgId as string)
      .filter(id => id && !orgMap.has(id));

    const memberOrgResults = await Promise.all(
      memberOrgIds.map(id => client.models.Organisation.get({ id }))
    );
    for (const res of memberOrgResults) {
      if (res.data) {
        const org = mapOrg(res.data as unknown as AmplifyRecord);
        orgMap.set(org.id, org);
      }
    }

    const orgs = Array.from(orgMap.values());

    // Enrich with member and robot counts (best-effort)
    const enriched = await Promise.all(
      orgs.map(async (org) => {
        try {
          const [membersRes, robotsRes] = await Promise.all([
            client.models.OrgMember.list({ filter: { orgId: { eq: org.id } } }),
            client.models.Robot.list({ filter: { orgId: { eq: org.id } } }),
          ]);
          return {
            ...org,
            memberCount: membersRes.data?.length || 0,
            robotCount: robotsRes.data?.length || 0,
          };
        } catch {
          return org;
        }
      })
    );

    return enriched;
  } catch (err) {
    logger.error('fetchUserOrganisations error:', err instanceof Error ? err.message : JSON.stringify(err));
    return [];
  }
}
