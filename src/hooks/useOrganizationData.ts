import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import type { Organization, OrgRole, OrgMember, OrgInvite, OrgRobot } from '../types/organization';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

function parseLambdaResponse<T = unknown>(raw: unknown): T {
  let parsed = raw;
  while (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed as T;
}

function parsePermissions(perms: unknown): string[] {
  if (Array.isArray(perms)) return perms as string[];
  if (typeof perms === 'string') {
    try { return JSON.parse(perms) as string[]; } catch { return []; }
  }
  return [];
}

export async function fetchUserOrganizations(userId: string): Promise<Organization[]> {
  const memberResult = await client.models.OrgMember.list({
    filter: { userId: { eq: userId } },
    selectionSet: ['id', 'orgId', 'userId', 'roleId', 'status', 'joinedAt'],
  });

  const memberships = memberResult.data ?? [];
  if (memberships.length === 0) return [];

  const orgIds = [...new Set(memberships.map(m => m.orgId).filter(Boolean))];

  const orgs: Organization[] = [];
  for (const id of orgIds) {
    try {
      const orgResult = await client.models.Organization.get({ id });
      const o = orgResult.data;
      if (!o) continue;

      const [memberCountResult, robotCountResult] = await Promise.all([
        client.models.OrgMember.list({ filter: { orgId: { eq: id } } }),
        client.models.OrgRobot.list({ filter: { orgId: { eq: id } }, selectionSet: ['id'] }),
      ]);
      const memberCount = memberCountResult.data?.length ?? 0;
      const robotCount = robotCountResult.data?.length ?? 0;

      orgs.push({
        id: o.id!,
        name: o.name,
        slug: o.slug,
        description: o.description ?? null,
        logoUrl: o.logoUrl ?? null,
        ownerId: o.ownerId,
        status: (o.status as Organization['status']) ?? 'active',
        creationCostCredits: o.creationCostCredits ?? null,
        maxMembers: o.maxMembers ?? 10,
        memberCount,
        robotCount,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt ?? null,
      });
    } catch (err) {
      logger.error(`fetchUserOrganizations: failed to get org ${id}`, err);
    }
  }

  return orgs;
}

export interface OrgDetail {
  org: Organization;
  roles: OrgRole[];
  members: OrgMember[];
  invites: OrgInvite[];
}

export async function fetchOrgDetail(orgId: string): Promise<OrgDetail | null> {
  const orgResult = await client.models.Organization.get({ id: orgId });
  const o = orgResult.data;
  if (!o) return null;

  const [rolesResult, membersResult, invitesResult, robotsCountResult] = await Promise.all([
    client.models.OrgRole.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'name', 'description', 'permissions', 'isSystem', 'priority', 'createdAt'],
    }),
    client.models.OrgMember.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'userId', 'userEmail', 'displayName', 'roleId', 'status', 'joinedAt'],
    }),
    client.models.OrgInvite.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'email', 'roleId', 'invitedBy', 'status', 'inviteCode', 'expiresAt', 'createdAt'],
    }),
    client.models.OrgRobot.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id'],
    }),
  ]);

  const roles: OrgRole[] = (rolesResult.data ?? []).map(r => ({
    id: r.id!,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? null,
    permissions: parsePermissions(r.permissions),
    isSystem: r.isSystem ?? false,
    priority: r.priority ?? 99,
    createdAt: r.createdAt ?? new Date().toISOString(),
  }));

  const members: OrgMember[] = (membersResult.data ?? []).map(m => {
    const role = roles.find(r => r.id === m.roleId);
    return {
      id: m.id!,
      orgId: m.orgId,
      userId: m.userId,
      userEmail: m.userEmail ?? null,
      displayName: (m as Record<string, unknown>).displayName as string ?? null,
      roleId: m.roleId,
      roleName: role?.name,
      status: (m.status as OrgMember['status']) ?? 'active',
      joinedAt: m.joinedAt ?? new Date().toISOString(),
    };
  });

  const invites: OrgInvite[] = (invitesResult.data ?? []).map(i => {
    const role = roles.find(r => r.id === i.roleId);
    return {
      id: i.id!,
      orgId: i.orgId,
      email: i.email,
      roleId: i.roleId,
      roleName: role?.name,
      invitedBy: i.invitedBy,
      status: (i.status as OrgInvite['status']) ?? 'pending',
      inviteCode: i.inviteCode,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt ?? new Date().toISOString(),
    };
  });

  const org: Organization = {
    id: o.id!,
    name: o.name,
    slug: o.slug,
    description: o.description ?? null,
    logoUrl: o.logoUrl ?? null,
    ownerId: o.ownerId,
    status: (o.status as Organization['status']) ?? 'active',
    creationCostCredits: o.creationCostCredits ?? null,
    maxMembers: o.maxMembers ?? 10,
    memberCount: members.length,
    robotCount: robotsCountResult.data?.length ?? 0,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt ?? null,
  };

  return { org, roles, members, invites };
}

interface CreateOrgResult {
  success: boolean;
  orgId?: string;
  slug?: string;
  error?: string;
}

export async function createOrganization(
  name: string,
  slug: string,
  description?: string,
): Promise<CreateOrgResult> {
  const result = await client.mutations.manageOrganizationLambda({
    action: 'create',
    name,
    slug,
    description: description || undefined,
  });

  if (result.errors?.length) {
    const msg = result.errors.map(e => e.message).join(', ');
    return { success: false, error: msg };
  }

  const body = parseLambdaResponse<CreateOrgResult>(result.data);
  return body;
}

interface InviteResult {
  success: boolean;
  inviteId?: string;
  inviteCode?: string;
  error?: string;
}

export async function inviteMember(
  orgId: string,
  email: string,
  roleId: string,
): Promise<InviteResult> {
  const result = await client.mutations.manageOrgMemberLambda({
    action: 'invite',
    orgId,
    email,
    roleId,
  });

  if (result.errors?.length) {
    const msg = result.errors.map(e => e.message).join(', ');
    logger.error('inviteMember errors:', result.errors);
    return { success: false, error: msg };
  }

  const body = parseLambdaResponse<InviteResult>(result.data);
  return body;
}

export interface PendingOrgInvite {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  roleName: string;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
}

export async function fetchPendingInvitesForUser(userEmail: string): Promise<PendingOrgInvite[]> {
  try {
    const result = await client.models.OrgInvite.list({
      filter: { email: { eq: userEmail }, status: { eq: 'pending' } },
      selectionSet: ['id', 'orgId', 'email', 'roleId', 'inviteCode', 'expiresAt', 'createdAt'],
    });

    const invites = result.data ?? [];
    if (invites.length === 0) return [];

    const pending: PendingOrgInvite[] = [];
    for (const inv of invites) {
      if (new Date(inv.expiresAt) < new Date()) continue;

      let orgName = 'Unknown Organization';
      let roleName = 'Member';
      try {
        const orgResult = await client.models.Organization.get({ id: inv.orgId });
        if (orgResult.data?.name) orgName = orgResult.data.name;
        const roleResult = await client.models.OrgRole.get({ id: inv.roleId });
        if (roleResult.data?.name) roleName = roleResult.data.name;
      } catch { /* continue with defaults */ }

      pending.push({
        id: inv.id!,
        orgId: inv.orgId,
        orgName,
        email: inv.email,
        roleName,
        inviteCode: inv.inviteCode,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt ?? new Date().toISOString(),
      });
    }
    return pending;
  } catch (err) {
    logger.error('fetchPendingInvitesForUser failed:', err);
    return [];
  }
}

interface AcceptInviteResult {
  success: boolean;
  orgId?: string;
  error?: string;
}

export async function acceptInvite(inviteCode: string): Promise<AcceptInviteResult> {
  const result = await client.mutations.manageOrgMemberLambda({
    action: 'accept',
    inviteCode,
  });

  if (result.errors?.length) {
    const msg = result.errors.map(e => e.message).join(', ');
    return { success: false, error: msg };
  }

  const body = parseLambdaResponse<AcceptInviteResult>(result.data);
  return body;
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<{ success: boolean; error?: string }> {
  const result = await client.mutations.manageOrgMemberLambda({
    action: 'revokeInvite',
    orgId,
    inviteId,
  });

  if (result.errors?.length) {
    const msg = result.errors.map(e => e.message).join(', ');
    return { success: false, error: msg };
  }

  const body = parseLambdaResponse<{ success: boolean; error?: string }>(result.data);
  return body;
}

export async function fetchOrgRobots(orgId: string): Promise<OrgRobot[]> {
  try {
    const bridgeResult = await client.models.OrgRobot.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'platformRobotId', 'assignedOperators', 'addedBy', 'createdAt'],
    });

    if (bridgeResult.errors?.length) {
      logger.error('fetchOrgRobots bridge errors:', bridgeResult.errors);
    }

    const bridges = bridgeResult.data ?? [];
    if (bridges.length === 0) return [];

    const robots: OrgRobot[] = [];
    for (const bridge of bridges) {
      try {
        const robotResult = await client.models.Robot.get(
          { id: bridge.platformRobotId },
          { selectionSet: ['id', 'name', 'description', 'model', 'robotType', 'robotId'] },
        );
        const r = robotResult.data;
        if (!r) continue;

        robots.push({
          id: bridge.id!,
          orgId: bridge.orgId,
          robotId: r.robotId ?? r.id!,
          name: r.name,
          model: r.model ?? 'Unknown',
          robotType: r.robotType ?? 'robot',
          connectionStatus: 'offline',
          lastSeen: null,
          ipAddress: null,
          firmwareVersion: null,
          totalSessions: 0,
          totalHours: 0,
          assignedOperators: (() => {
            const ops = (bridge.assignedOperators ?? []).filter(Boolean) as string[];
            if (ops.length === 0 && bridge.addedBy) ops.push(bridge.addedBy as string);
            return ops;
          })(),
          createdAt: bridge.createdAt ?? new Date().toISOString(),
        });
      } catch {
        logger.error(`fetchOrgRobots: failed to resolve robot ${bridge.platformRobotId}`);
      }
    }

    return robots;
  } catch (err) {
    logger.error('fetchOrgRobots failed:', err);
    return [];
  }
}

export async function linkRobotToOrg(
  orgId: string,
  platformRobotId: string,
  creatorUserId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await client.models.OrgRobot.list({
      filter: { orgId: { eq: orgId }, platformRobotId: { eq: platformRobotId } },
      selectionSet: ['id'],
    });
    if (existing.data?.length) {
      return { success: false, error: 'Robot is already linked to this organization' };
    }

    const now = new Date().toISOString();
    const result = await client.models.OrgRobot.create({
      orgId,
      platformRobotId,
      addedBy: creatorUserId || undefined,
      assignedOperators: creatorUserId ? [creatorUserId] : [],
      createdAt: now,
      updatedAt: now,
    });

    if (result.errors?.length) {
      const msg = result.errors.map(e => e.message).join(', ');
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (err) {
    logger.error('linkRobotToOrg failed:', err);
    return { success: false, error: String(err) };
  }
}

export async function unlinkRobotFromOrg(bridgeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await client.models.OrgRobot.delete({ id: bridgeId });
    if (result.errors?.length) {
      const msg = result.errors.map(e => e.message).join(', ');
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (err) {
    logger.error('unlinkRobotFromOrg failed:', err);
    return { success: false, error: String(err) };
  }
}
