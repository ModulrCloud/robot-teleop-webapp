import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const cognito = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;

export const handler: Schema["removeAdminLambda"]["functionHandler"] = async (event) => {
  console.log("Remove Admin request:", JSON.stringify(event, null, 2));
  
  const { targetUserId, reason } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const adminUserId = identity.username;
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isAdmin = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");

  // SECURITY: Only existing admins can remove admin status
  if (!isAdmin) {
    throw new Error("Unauthorized: only ADMINS can remove admin status");
  }

  if (!targetUserId) {
    throw new Error("Missing required argument: targetUserId");
  }

  // SECURITY: Prevent removing yourself (must be done by another admin)
  if (adminUserId === targetUserId) {
    throw new Error("Cannot remove your own admin status. Another admin must do this.");
  }

  try {
    // Check how many admins exist
    const adminsList = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: 'ADMINS',
      })
    );

    const adminCount = adminsList.Users?.length || 0;

    // SECURITY: Prevent removing the last admin
    if (adminCount <= 1) {
      throw new Error("Cannot remove the last admin. At least one admin must remain.");
    }

    // Verify target user is actually an admin
    const targetUserGroups = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUserId,
      })
    );

    const isTargetAdmin = targetUserGroups.Groups?.some(
      g => g.GroupName === 'ADMINS' || g.GroupName === 'ADMIN'
    );

    if (!isTargetAdmin) {
      throw new Error(`User ${targetUserId} is not an admin`);
    }

    // Remove user from ADMINS group
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUserId,
        GroupName: 'ADMINS',
      })
    );

    // Create audit log entry
    await docClient.send(
      new PutCommand({
        TableName: ADMIN_AUDIT_TABLE,
        Item: {
          id: randomUUID(),
          action: 'REMOVE_ADMIN',
          adminUserId,
          targetUserId,
          reason: reason || null,
          timestamp: new Date().toISOString(),
          metadata: {
            adminGroups: adminGroups || [],
            remainingAdminCount: adminCount - 1,
          },
        },
      })
    );

    console.log(`Admin ${adminUserId} removed admin status from ${targetUserId}. Reason: ${reason || 'N/A'}`);

    return JSON.stringify({
      success: true,
      message: `Successfully removed admin status from ${targetUserId}`,
      removedBy: adminUserId,
      removedFrom: targetUserId,
      remainingAdminCount: adminCount - 1,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error removing admin:", error);
    throw new Error(`Failed to remove admin: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

