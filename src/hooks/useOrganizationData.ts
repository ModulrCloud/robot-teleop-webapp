import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import type { Organization, OrgRole, OrgMember, OrgInvite } from '../types/organization';
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

      const memberCountResult = await client.models.OrgMember.list({
        filter: { orgId: { eq: id } },
      });
      const memberCount = memberCountResult.data?.length ?? 0;

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
        robotCount: 0,
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

  const [rolesResult, membersResult, invitesResult] = await Promise.all([
    client.models.OrgRole.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'name', 'description', 'permissions', 'isSystem', 'priority', 'createdAt'],
    }),
    client.models.OrgMember.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'userId', 'userEmail', 'roleId', 'status', 'joinedAt'],
    }),
    client.models.OrgInvite.list({
      filter: { orgId: { eq: orgId } },
      selectionSet: ['id', 'orgId', 'email', 'roleId', 'invitedBy', 'status', 'inviteCode', 'expiresAt', 'createdAt'],
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
    robotCount: 0,
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
