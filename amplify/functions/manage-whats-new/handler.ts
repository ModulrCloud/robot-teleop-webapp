import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "crypto";
import { createAuditLog } from "../shared/audit-log";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const WHATS_NEW_TABLE = process.env.WHATS_NEW_TABLE!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ItemData {
  title?: string;
  summary?: string;
  link?: string;
  publishedAt?: string;
  sortOrder?: number;
}

function parseItemData(raw: unknown): ItemData {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ItemData;
    } catch {
      throw new Error("Invalid itemData: must be valid JSON");
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw as ItemData;
  }
  throw new Error("Invalid itemData: must be an object");
}

export const handler: Schema["manageWhatsNewLambda"]["functionHandler"] = async (event) => {
  const { action, itemId, itemData: itemDataRaw } = event.arguments ?? {};
  const identity = event.identity;

  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  let userEmail: string | undefined;
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find((attr) => attr.Name === "email")?.Value;
  } catch (err) {
    console.error("Could not fetch email from Cognito:", err);
    throw new Error("Unauthorized: could not verify user email");
  }
  if (!userEmail) {
    throw new Error("Unauthorized: user email not found");
  }

  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = Array.isArray(adminGroups) && (adminGroups.includes("ADMINS") || adminGroups.includes("ADMIN"));
  const isModulrEmployee =
    typeof userEmail === "string" && userEmail.toLowerCase().trim().endsWith("@modulr.cloud");

  if (!isInAdminGroup && !isModulrEmployee) {
    throw new Error("Unauthorized: only ADMINS or Ctrl + R employees (@modulr.cloud) can manage What's New");
  }

  const now = new Date().toISOString();
  const dateOnly = now.slice(0, 10);

  try {
    switch (action) {
      case "create": {
        const itemData = parseItemData(itemDataRaw);
        if (!itemData.title?.trim()) {
          throw new Error("Missing required field: title");
        }
        // Honor admin-provided sortOrder on create; otherwise auto-increment so new item displays first
        let sortOrder: number;
        if (typeof itemData.sortOrder === "number") {
          sortOrder = itemData.sortOrder;
        } else {
          const scanResult = await docClient.send(
            new ScanCommand({ TableName: WHATS_NEW_TABLE })
          );
          const existing = (scanResult.Items ?? []) as { sortOrder?: number }[];
          const maxOrder = existing.length
            ? Math.max(0, ...existing.map((i) => (typeof i.sortOrder === "number" ? i.sortOrder : 0)))
            : -1;
          sortOrder = maxOrder + 1;
        }

        const id = randomUUID();
        const item = {
          id,
          title: itemData.title.trim(),
          summary: (itemData.summary ?? "").trim(),
          link: (itemData.link ?? "").trim(),
          publishedAt: itemData.publishedAt ?? dateOnly,
          sortOrder,
          createdAt: now,
          updatedAt: now,
        };
        await docClient.send(
          new PutCommand({
            TableName: WHATS_NEW_TABLE,
            Item: item,
          })
        );
        try {
          await createAuditLog(docClient, {
            action: "CREATE_WHATS_NEW",
            adminUserId: identity.username,
            reason: item.title,
            metadata: { itemId: id, title: item.title },
          });
        } catch {
          // non-fatal
        }
        return JSON.stringify({ success: true, data: item });
      }

      case "update": {
        if (!itemId) throw new Error("Missing required argument: itemId");
        const itemData = parseItemData(itemDataRaw);
        const getResult = await docClient.send(
          new GetCommand({
            TableName: WHATS_NEW_TABLE,
            Key: { id: itemId },
          })
        );
        if (!getResult.Item) {
          throw new Error(`What's New item not found: ${itemId}`);
        }
        const updates: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = { ":updatedAt": now };
        if (itemData.title !== undefined) {
          updates.push("#title = :title");
          names["#title"] = "title";
          values[":title"] = String(itemData.title).trim();
        }
        if (itemData.summary !== undefined) {
          updates.push("#summary = :summary");
          names["#summary"] = "summary";
          values[":summary"] = String(itemData.summary).trim();
        }
        if (itemData.link !== undefined) {
          updates.push("#link = :link");
          names["#link"] = "link";
          values[":link"] = String(itemData.link).trim();
        }
        if (itemData.publishedAt !== undefined) {
          updates.push("publishedAt = :publishedAt");
          values[":publishedAt"] = String(itemData.publishedAt);
        }
        if (itemData.sortOrder !== undefined) {
          updates.push("sortOrder = :sortOrder");
          values[":sortOrder"] = Number(itemData.sortOrder);
        }
        updates.push("updatedAt = :updatedAt");
        await docClient.send(
          new UpdateCommand({
            TableName: WHATS_NEW_TABLE,
            Key: { id: itemId },
            UpdateExpression: `SET ${updates.join(", ")}`,
            ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
            ExpressionAttributeValues: values,
          })
        );
        const updated = await docClient.send(
          new GetCommand({ TableName: WHATS_NEW_TABLE, Key: { id: itemId } })
        );
        try {
          await createAuditLog(docClient, {
            action: "UPDATE_WHATS_NEW",
            adminUserId: identity.username,
            metadata: { itemId, title: itemData.title ?? getResult.Item?.title },
          });
        } catch {
          // non-fatal
        }
        return JSON.stringify({ success: true, data: updated.Item });
      }

      case "delete": {
        if (!itemId) throw new Error("Missing required argument: itemId");
        const getResult = await docClient.send(
          new GetCommand({
            TableName: WHATS_NEW_TABLE,
            Key: { id: itemId },
          })
        );
        if (!getResult.Item) {
          throw new Error(`What's New item not found: ${itemId}`);
        }
        await docClient.send(
          new DeleteCommand({
            TableName: WHATS_NEW_TABLE,
            Key: { id: itemId },
          })
        );
        try {
          await createAuditLog(docClient, {
            action: "DELETE_WHATS_NEW",
            adminUserId: identity.username,
            metadata: { itemId, title: getResult.Item.title },
          });
        } catch {
          // non-fatal
        }
        return JSON.stringify({ success: true, message: "Item deleted" });
      }

      default:
        throw new Error(`Invalid action: ${action}. Must be 'create', 'update', or 'delete'`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("manageWhatsNew error:", message);
    throw new Error(`Failed to manage What's New: ${message}`);
  }
};
