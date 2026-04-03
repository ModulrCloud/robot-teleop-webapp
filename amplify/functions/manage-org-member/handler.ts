import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID, randomBytes } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({});

const ORG_TABLE = process.env.ORG_TABLE!;
const ORG_ROLE_TABLE = process.env.ORG_ROLE_TABLE!;
const ORG_MEMBER_TABLE = process.env.ORG_MEMBER_TABLE!;
const ORG_INVITE_TABLE = process.env.ORG_INVITE_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const PARTNER_TABLE = process.env.PARTNER_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE!;
const ORG_ROBOT_TABLE = process.env.ORG_ROBOT_TABLE!;

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

async function lookupUserByEmail(email: string) {
  const result = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email}"`,
      Limit: 1,
    })
  );
  const user = result.Users?.[0];
  if (!user?.Username) return null;

  const groupsResult = await cognitoClient.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: user.Username,
    })
  );
  const groups = groupsResult.Groups?.map(g => g.GroupName || "") || [];

  const attrs = user.Attributes ?? [];
  const nameAttr = attrs.find(a => a.Name === "name")?.Value;
  const emailAttr = attrs.find(a => a.Name === "email")?.Value;
  const displayName = nameAttr || emailAttr?.split("@")[0] || null;

  return { username: user.Username, email: emailAttr || email, displayName, groups };
}

async function resolveDisplayName(cognitoUsername: string): Promise<string | null> {
  try {
    const result = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: cognitoUsername })
    );
    const attrs = result.UserAttributes ?? [];
    const name = attrs.find(a => a.Name === "name")?.Value;
    const email = attrs.find(a => a.Name === "email")?.Value;
    return name || email?.split("@")[0] || null;
  } catch {
    return null;
  }
}

async function lookupGroupsForUsername(username: string): Promise<string[]> {
  try {
    const result = await cognitoClient.send(
      new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    );
    return result.Groups?.map(g => g.GroupName || "").filter(Boolean) || [];
  } catch {
    return [];
  }
}

async function getPartnerByUsername(cognitoUsername: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: PARTNER_TABLE,
      IndexName: "cognitoUsernameIndex",
      KeyConditionExpression: "cognitoUsername = :u",
      ExpressionAttributeValues: { ":u": cognitoUsername },
      Limit: 1,
    })
  );
  return result.Items?.[0] ?? null;
}

async function getRobotsByPartnerId(partnerId: string) {
  const result = await docClient.send(
    new ScanCommand({
      TableName: ROBOT_TABLE,
      FilterExpression: "partnerId = :pid",
      ExpressionAttributeValues: { ":pid": partnerId },
    })
  );
  return result.Items ?? [];
}

async function linkRobotsToOrg(orgId: string, robotIds: string[], addedBy: string, ownerUsername?: string) {
  const now = new Date().toISOString();
  const operators = ownerUsername ? [ownerUsername] : [];
  for (const robotId of robotIds) {
    const existing = await docClient.send(
      new QueryCommand({
        TableName: ORG_ROBOT_TABLE,
        IndexName: "platformRobotIdIndex",
        KeyConditionExpression: "platformRobotId = :rid",
        FilterExpression: "orgId = :oid",
        ExpressionAttributeValues: { ":rid": robotId, ":oid": orgId },
        Limit: 1,
      })
    );

    if (existing.Items?.length) {
      if (ownerUsername) {
        const record = existing.Items[0];
        const currentOps = (record.assignedOperators as string[]) ?? [];
        if (!currentOps.includes(ownerUsername)) {
          await docClient.send(
            new UpdateCommand({
              TableName: ORG_ROBOT_TABLE,
              Key: { id: record.id },
              UpdateExpression: "SET assignedOperators = :ops, updatedAt = :now",
              ExpressionAttributeValues: {
                ":ops": [...currentOps, ownerUsername],
                ":now": now,
              },
            })
          );
        }
      }
      continue;
    }

    await docClient.send(
      new PutCommand({
        TableName: ORG_ROBOT_TABLE,
        Item: {
          id: randomUUID(),
          orgId,
          platformRobotId: robotId,
          addedBy,
          assignedOperators: operators,
          createdAt: now,
          updatedAt: now,
          owner: addedBy,
        },
      })
    );
  }
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

    const cognitoUser = await lookupUserByEmail(email);
    if (!cognitoUser) {
      throw new Error("No account found for this email. The user must sign up on Ctrl + R first.");
    }

    const existingMember = members.find((m) => m.userEmail === email || m.userId === email || m.userId === cognitoUser.username);
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

    const isPartner = cognitoUser.groups.includes("PARTNERS");

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
          inviteeUsername: cognitoUser.username,
          inviteeDisplayName: cognitoUser.displayName || email.split("@")[0],
          status: "pending",
          inviteCode,
          expiresAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          owner: callerUsername,
        },
      })
    );

    return JSON.stringify({
      success: true,
      inviteId,
      inviteCode,
      expiresAt: expiresAt.toISOString(),
      isPartner,
    });
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
    const displayName = await resolveDisplayName(callerUsername);

    await docClient.send(
      new PutCommand({
        TableName: ORG_MEMBER_TABLE,
        Item: {
          id: randomUUID(),
          orgId: invite.orgId,
          userId: callerUsername,
          userEmail: invite.email,
          displayName: displayName || invite.email?.toString().split("@")[0] || null,
          roleId: invite.roleId,
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
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

    let linkedRobotCount = 0;
    try {
      const callerGroups = await lookupGroupsForUsername(callerUsername);
      if (callerGroups.includes("PARTNERS")) {
        const partner = await getPartnerByUsername(callerUsername);
        if (partner?.id) {
          const robots = await getRobotsByPartnerId(partner.id as string);
          const robotIds = robots.map(r => r.id as string).filter(Boolean);
          if (robotIds.length > 0) {
            await linkRobotsToOrg(invite.orgId as string, robotIds, callerUsername, callerUsername);
            linkedRobotCount = robotIds.length;
          }
        }
      }
    } catch { /* non-critical: robots can be linked manually */ }

    return JSON.stringify({ success: true, orgId: invite.orgId, role: invite.roleId, linkedRobotCount });
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

  // REVOKE INVITE
  if (action === "revokeInvite") {
    const { orgId, inviteId } = event.arguments;
    if (!orgId || !inviteId) throw new Error("Missing required: orgId, inviteId");

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

    await docClient.send(
      new UpdateCommand({
        TableName: ORG_INVITE_TABLE,
        Key: { id: inviteId },
        UpdateExpression: "SET #s = :revoked",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":revoked": "revoked" },
      })
    );

    return JSON.stringify({ success: true, orgId, revokedInviteId: inviteId });
  }

  throw new Error(`Unknown action: ${action}. Valid: invite, accept, remove, updateRole, revokeInvite`);
};
