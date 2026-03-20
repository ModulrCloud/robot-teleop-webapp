import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ORG_TABLE = process.env.ORG_TABLE!;
const ORG_ROLE_TABLE = process.env.ORG_ROLE_TABLE!;
const ORG_MEMBER_TABLE = process.env.ORG_MEMBER_TABLE!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;

const DEFAULT_ROLES = [
  {
    name: "Owner",
    description: "Full control. Cannot be removed.",
    permissions: ["*"],
    isSystem: true,
    priority: 0,
  },
  {
    name: "Admin",
    description: "Manage members, roles, robots, and settings.",
    permissions: [
      "members:view", "members:manage",
      "roles:view", "roles:manage",
      "robots:view", "robots:manage",
      "sessions:view", "logs:view",
      "settings:view", "settings:manage",
      "commands:view", "commands:manage",
      "notifications:manage",
    ],
    isSystem: true,
    priority: 1,
  },
  {
    name: "Operator",
    description: "Operate robots and view sessions.",
    permissions: [
      "members:view",
      "robots:view", "robots:operate",
      "sessions:view",
      "commands:view", "commands:execute",
    ],
    isSystem: true,
    priority: 2,
  },
  {
    name: "Viewer",
    description: "Read-only access to the organization.",
    permissions: ["members:view", "robots:view", "sessions:view", "logs:view"],
    isSystem: true,
    priority: 3,
  },
];

async function getPlatformSetting(key: string): Promise<string | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: PLATFORM_SETTINGS_TABLE,
      IndexName: "settingKeyIndex",
      KeyConditionExpression: "settingKey = :key",
      ExpressionAttributeValues: { ":key": key },
      Limit: 1,
    })
  );
  return result.Items?.[0]?.settingValue ?? null;
}

async function getUserCreditsRecord(userId: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: USER_CREDITS_TABLE,
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      Limit: 1,
    })
  );
  const item = result.Items?.[0];
  return item ? { id: item.id as string, credits: (item.credits ?? 0) as number } : null;
}

async function getOrgById(orgId: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ORG_TABLE,
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: { ":id": orgId },
      Limit: 1,
    })
  );
  return result.Items?.[0] ?? null;
}

async function getCallerPermissions(orgId: string, userId: string): Promise<string[]> {
  const memberQuery = await docClient.send(
    new QueryCommand({
      TableName: ORG_MEMBER_TABLE,
      IndexName: "orgIdIndex",
      KeyConditionExpression: "orgId = :orgId",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":orgId": orgId, ":userId": userId },
    })
  );
  const membership = memberQuery.Items?.[0];
  if (!membership) return [];

  const roleQuery = await docClient.send(
    new QueryCommand({
      TableName: ORG_ROLE_TABLE,
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: { ":id": membership.roleId },
      Limit: 1,
    })
  );
  const role = roleQuery.Items?.[0];
  return role?.permissions ? JSON.parse(role.permissions) : [];
}

async function batchDelete(tableName: string, items: Record<string, unknown>[]) {
  for (let i = 0; i < items.length; i += 25) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: items.slice(i, i + 25).map((item) => ({
            DeleteRequest: { Key: { id: item.id } },
          })),
        },
      })
    );
  }
}

export const handler: Schema["manageOrganizationLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }

  const callerUsername = identity.username;
  const identityExt = identity as unknown as { email?: string; claims?: { email?: string } };
  const callerEmail = identityExt.email || identityExt.claims?.email || null;
  const callerGroups = "groups" in identity ? (identity.groups as string[]) : [];
  const isPlatformAdmin = callerGroups?.includes("ADMINS") || callerGroups?.includes("ADMIN");
  const { action } = event.arguments;

  // CREATE
  if (action === "create") {
    const { name, slug, description } = event.arguments;
    if (!name || !slug) throw new Error("Missing required: name, slug");

    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      throw new Error("Invalid slug: 3-50 chars, lowercase alphanumeric/hyphens, must start/end with alphanumeric");
    }

    const existingSlug = await docClient.send(
      new QueryCommand({
        TableName: ORG_TABLE,
        IndexName: "slugIndex",
        KeyConditionExpression: "slug = :slug",
        ExpressionAttributeValues: { ":slug": slug },
        Limit: 1,
      })
    );
    if (existingSlug.Items?.length) throw new Error(`Slug "${slug}" is already taken`);

    const isOrgAccount = callerGroups?.includes("ORGANIZATIONS");
    let creationCost = 0;

    if (!isOrgAccount && !isPlatformAdmin) {
      const costSetting = await getPlatformSetting("orgCreationCostCredits");
      creationCost = costSetting ? parseFloat(costSetting) : 500;

      const creditsRecord = await getUserCreditsRecord(callerUsername);
      if (!creditsRecord || creditsRecord.credits < creationCost) {
        throw new Error(`Insufficient credits. Need ${creationCost}, have ${creditsRecord?.credits ?? 0}`);
      }

      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: creditsRecord.id },
          UpdateExpression: "SET credits = :new, lastUpdated = :now",
          ConditionExpression: "credits >= :cost",
          ExpressionAttributeValues: {
            ":new": creditsRecord.credits - creationCost,
            ":cost": creationCost,
            ":now": new Date().toISOString(),
          },
        })
      );

      await docClient.send(
        new PutCommand({
          TableName: CREDIT_TRANSACTIONS_TABLE,
          Item: {
            id: randomUUID(),
            userId: callerUsername,
            amount: -creationCost,
            transactionType: "deduction",
            description: `Organization created: ${name}`,
            createdAt: new Date().toISOString(),
          },
        })
      );
    }

    const now = new Date().toISOString();
    const orgId = randomUUID();

    await docClient.send(
      new PutCommand({
        TableName: ORG_TABLE,
        Item: {
          id: orgId,
          name,
          slug,
          description: description ?? null,
          logoUrl: null,
          ownerId: callerUsername,
          status: "active",
          creationCostCredits: creationCost,
          maxMembers: 10,
          createdAt: now,
          updatedAt: now,
          owner: callerUsername,
        },
      })
    );

    const roleIds: Record<string, string> = {};
    for (const role of DEFAULT_ROLES) {
      const roleId = randomUUID();
      roleIds[role.name] = roleId;
      await docClient.send(
        new PutCommand({
          TableName: ORG_ROLE_TABLE,
          Item: {
            id: roleId,
            orgId,
            name: role.name,
            description: role.description,
            permissions: JSON.stringify(role.permissions),
            isSystem: role.isSystem,
            priority: role.priority,
            createdAt: now,
            updatedAt: now,
            owner: callerUsername,
          },
        })
      );
    }

    await docClient.send(
      new PutCommand({
        TableName: ORG_MEMBER_TABLE,
        Item: {
          id: randomUUID(),
          orgId,
          userId: callerUsername,
          userEmail: callerEmail,
          roleId: roleIds["Owner"],
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          owner: callerUsername,
        },
      })
    );

    return JSON.stringify({
      success: true,
      orgId,
      slug,
      creationCost,
      roles: Object.entries(roleIds).map(([name, id]) => ({ name, id })),
    });
  }

  // UPDATE
  if (action === "update") {
    const { orgId, name, description, logoUrl } = event.arguments;
    if (!orgId) throw new Error("Missing required: orgId");

    const org = await getOrgById(orgId);
    if (!org) throw new Error("Organization not found");

    if (org.ownerId !== callerUsername && !isPlatformAdmin) {
      const perms = await getCallerPermissions(orgId, callerUsername);
      if (!perms.includes("*") && !perms.includes("settings:manage")) {
        throw new Error("Unauthorized: requires settings:manage permission");
      }
    }

    const updates: string[] = ["updatedAt = :now"];
    const values: Record<string, unknown> = { ":now": new Date().toISOString() };
    const names: Record<string, string> = {};

    if (name !== undefined && name !== null) {
      updates.push("#n = :name");
      values[":name"] = name;
      names["#n"] = "name";
    }
    if (description !== undefined) {
      updates.push("description = :desc");
      values[":desc"] = description;
    }
    if (logoUrl !== undefined) {
      updates.push("logoUrl = :logo");
      values[":logo"] = logoUrl;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: ORG_TABLE,
        Key: { id: orgId },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: values,
        ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      })
    );

    return JSON.stringify({ success: true, orgId });
  }

  // DELETE
  if (action === "delete") {
    const { orgId } = event.arguments;
    if (!orgId) throw new Error("Missing required: orgId");

    const org = await getOrgById(orgId);
    if (!org) throw new Error("Organization not found");

    if (org.ownerId !== callerUsername && !isPlatformAdmin) {
      throw new Error("Unauthorized: only the owner or a platform admin can delete");
    }

    const members = await docClient.send(
      new QueryCommand({
        TableName: ORG_MEMBER_TABLE,
        IndexName: "orgIdIndex",
        KeyConditionExpression: "orgId = :orgId",
        ExpressionAttributeValues: { ":orgId": orgId },
      })
    );
    if (members.Items?.length) await batchDelete(ORG_MEMBER_TABLE, members.Items);

    const roles = await docClient.send(
      new QueryCommand({
        TableName: ORG_ROLE_TABLE,
        IndexName: "orgIdIndex",
        KeyConditionExpression: "orgId = :orgId",
        ExpressionAttributeValues: { ":orgId": orgId },
      })
    );
    if (roles.Items?.length) await batchDelete(ORG_ROLE_TABLE, roles.Items);

    await docClient.send(new DeleteCommand({ TableName: ORG_TABLE, Key: { id: orgId } }));

    return JSON.stringify({ success: true, orgId, deleted: true });
  }

  throw new Error(`Unknown action: ${action}. Valid: create, update, delete`);
};
