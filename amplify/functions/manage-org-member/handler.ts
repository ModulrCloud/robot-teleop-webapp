import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID, randomBytes } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ORG_TABLE = process.env.ORG_TABLE!;
const ORG_ROLE_TABLE = process.env.ORG_ROLE_TABLE!;
const ORG_MEMBER_TABLE = process.env.ORG_MEMBER_TABLE!;
const ORG_INVITE_TABLE = process.env.ORG_INVITE_TABLE!;

const INVITE_EXPIRY_DAYS = 7;

async function getOrg(orgId: string) {
  const result = await docClient.send(new GetCommand({ TableName: ORG_TABLE, Key: { id: orgId } }));
  return result.Item ?? null;
}

async function getOrgMembers(orgId: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ORG_MEMBER_TABLE,
      IndexName: "orgIdIndex",
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": orgId },
    })
  );
  return result.Items ?? [];
}

async function getCallerMembership(orgId: string, userId: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ORG_MEMBER_TABLE,
      IndexName: "orgIdIndex",
      KeyConditionExpression: "orgId = :orgId",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":orgId": orgId, ":userId": userId },
    })
  );
  return result.Items?.[0] ?? null;
}

async function getRole(roleId: string) {
  const result = await docClient.send(new GetCommand({ TableName: ORG_ROLE_TABLE, Key: { id: roleId } }));
  return result.Item ?? null;
}

function parsePermissions(role: Record<string, unknown> | null): string[] {
  if (!role?.permissions) return [];
  return typeof role.permissions === "string" ? JSON.parse(role.permissions) : role.permissions as string[];
}

function hasPermission(perms: string[], required: string): boolean {
  return perms.includes("*") || perms.includes(required);
}

export const handler: Schema["manageOrgMemberLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }

  const callerUsername = identity.username;
  const callerGroups = "groups" in identity ? (identity.groups as string[]) : [];
  const isPlatformAdmin = callerGroups?.includes("ADMINS") || callerGroups?.includes("ADMIN");
  const { action } = event.arguments;

  // INVITE
  if (action === "invite") {
    const { orgId, email, roleId } = event.arguments;
    if (!orgId || !email || !roleId) throw new Error("Missing required: orgId, email, roleId");

    const org = await getOrg(orgId);
    if (!org) throw new Error("Organization not found");

    if (!isPlatformAdmin) {
      const membership = await getCallerMembership(orgId, callerUsername);
      if (!membership) throw new Error("Unauthorized: not a member");
      const role = await getRole(membership.roleId as string);
      if (!hasPermission(parsePermissions(role), "members:manage")) {
        throw new Error("Unauthorized: requires members:manage permission");
      }
    }

    const targetRole = await getRole(roleId);
    if (!targetRole || targetRole.orgId !== orgId) throw new Error("Role not found in this organization");

    const members = await getOrgMembers(orgId);
    if (members.length >= (org.maxMembers ?? 10)) {
      throw new Error(`Member cap reached (${org.maxMembers ?? 10}). Upgrade to add more.`);
    }

    const existingMember = members.find((m) => m.userEmail === email || m.userId === email);
    if (existingMember) throw new Error("User is already a member of this organization");

    const existingInvite = await docClient.send(
      new QueryCommand({
        TableName: ORG_INVITE_TABLE,
        IndexName: "emailIndex",
        KeyConditionExpression: "email = :email",
        FilterExpression: "orgId = :orgId AND #s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":email": email, ":orgId": orgId, ":pending": "pending" },
      })
    );
    if (existingInvite.Items?.length) throw new Error("A pending invite already exists for this email");

    const inviteCode = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const inviteId = randomUUID();

    await docClient.send(
      new PutCommand({
        TableName: ORG_INVITE_TABLE,
        Item: {
          id: inviteId,
          orgId,
          email,
          roleId,
          invitedBy: callerUsername,
          status: "pending",
          inviteCode,
          expiresAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
          owner: callerUsername,
        },
      })
    );

    return JSON.stringify({ success: true, inviteId, inviteCode, expiresAt: expiresAt.toISOString() });
  }

  // ACCEPT
  if (action === "accept") {
    const { inviteCode } = event.arguments;
    if (!inviteCode) throw new Error("Missing required: inviteCode");

    const inviteQuery = await docClient.send(
      new QueryCommand({
        TableName: ORG_INVITE_TABLE,
        IndexName: "inviteCodeIndex",
        KeyConditionExpression: "inviteCode = :code",
        ExpressionAttributeValues: { ":code": inviteCode },
        Limit: 1,
      })
    );
    const invite = inviteQuery.Items?.[0];
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "pending") throw new Error(`Invite already ${invite.status}`);
    if (new Date(invite.expiresAt as string) < new Date()) {
      await docClient.send(
        new UpdateCommand({
          TableName: ORG_INVITE_TABLE,
          Key: { id: invite.id },
          UpdateExpression: "SET #s = :expired",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":expired": "expired" },
        })
      );
      throw new Error("Invite has expired");
    }

    const org = await getOrg(invite.orgId as string);
    if (!org) throw new Error("Organization no longer exists");

    const members = await getOrgMembers(invite.orgId as string);
    const alreadyMember = members.find((m) => m.userId === callerUsername);
    if (alreadyMember) throw new Error("You are already a member of this organization");

    if (members.length >= (org.maxMembers ?? 10)) {
      throw new Error("Organization has reached its member cap");
    }

    const now = new Date().toISOString();

    await docClient.send(
      new PutCommand({
        TableName: ORG_MEMBER_TABLE,
        Item: {
          id: randomUUID(),
          orgId: invite.orgId,
          userId: callerUsername,
          userEmail: invite.email,
          roleId: invite.roleId,
          status: "active",
          joinedAt: now,
          owner: callerUsername,
        },
      })
    );

    await docClient.send(
      new UpdateCommand({
        TableName: ORG_INVITE_TABLE,
        Key: { id: invite.id },
        UpdateExpression: "SET #s = :accepted",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":accepted": "accepted" },
      })
    );

    return JSON.stringify({ success: true, orgId: invite.orgId, role: invite.roleId });
  }

  // REMOVE
  if (action === "remove") {
    const { orgId, targetUserId } = event.arguments;
    if (!orgId || !targetUserId) throw new Error("Missing required: orgId, targetUserId");

    const org = await getOrg(orgId);
    if (!org) throw new Error("Organization not found");

    if (targetUserId === org.ownerId) throw new Error("Cannot remove the organization owner");

    const isSelfRemoval = targetUserId === callerUsername;
    if (!isSelfRemoval && !isPlatformAdmin) {
      const membership = await getCallerMembership(orgId, callerUsername);
      if (!membership) throw new Error("Unauthorized: not a member");
      const role = await getRole(membership.roleId as string);
      if (!hasPermission(parsePermissions(role), "members:manage")) {
        throw new Error("Unauthorized: requires members:manage permission");
      }
    }

    const targetMembership = await getCallerMembership(orgId, targetUserId);
    if (!targetMembership) throw new Error("Target user is not a member");

    await docClient.send(new DeleteCommand({ TableName: ORG_MEMBER_TABLE, Key: { id: targetMembership.id } }));

    return JSON.stringify({ success: true, orgId, removedUserId: targetUserId });
  }

  // UPDATE ROLE
  if (action === "updateRole") {
    const { orgId, targetUserId, roleId } = event.arguments;
    if (!orgId || !targetUserId || !roleId) throw new Error("Missing required: orgId, targetUserId, roleId");

    const org = await getOrg(orgId);
    if (!org) throw new Error("Organization not found");

    if (targetUserId === org.ownerId) throw new Error("Cannot change the owner's role");

    if (!isPlatformAdmin) {
      const membership = await getCallerMembership(orgId, callerUsername);
      if (!membership) throw new Error("Unauthorized: not a member");
      const role = await getRole(membership.roleId as string);
      if (!hasPermission(parsePermissions(role), "members:manage")) {
        throw new Error("Unauthorized: requires members:manage permission");
      }
    }

    const targetRole = await getRole(roleId);
    if (!targetRole || targetRole.orgId !== orgId) throw new Error("Role not found in this organization");

    const targetMembership = await getCallerMembership(orgId, targetUserId);
    if (!targetMembership) throw new Error("Target user is not a member");

    await docClient.send(
      new UpdateCommand({
        TableName: ORG_MEMBER_TABLE,
        Key: { id: targetMembership.id },
        UpdateExpression: "SET roleId = :roleId",
        ExpressionAttributeValues: { ":roleId": roleId },
      })
    );

    return JSON.stringify({ success: true, orgId, targetUserId, newRoleId: roleId });
  }

  throw new Error(`Unknown action: ${action}. Valid: invite, accept, remove, updateRole`);
};
