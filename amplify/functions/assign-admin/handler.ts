import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const cognito = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;

export const handler: Schema["assignAdminLambda"]["functionHandler"] = async (event) => {
  console.log("Assign Admin request:", JSON.stringify(event, null, 2));
  
  const { targetUserId, reason } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const adminUserId = identity.username;
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isAdmin = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");

  // SECURITY: Only existing admins can assign admin status
  if (!isAdmin) {
    throw new Error("Unauthorized: only ADMINS can assign admin status");
  }

  if (!targetUserId) {
    throw new Error("Missing required argument: targetUserId");
  }

  try {
    // Verify target user exists and is not already an admin
    const targetUserGroups = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUserId,
      })
    );

    const isAlreadyAdmin = targetUserGroups.Groups?.some(
      g => g.GroupName === 'ADMINS' || g.GroupName === 'ADMIN'
    );

    if (isAlreadyAdmin) {
      throw new Error(`User ${targetUserId} is already an admin`);
    }

    // Add user to ADMINS group
    await cognito.send(
      new AdminAddUserToGroupCommand({
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
          action: 'ASSIGN_ADMIN',
          adminUserId,
          targetUserId,
          reason: reason || null,
          timestamp: new Date().toISOString(),
          metadata: {
            adminGroups: adminGroups || [],
          },
        },
      })
    );

    console.log(`Admin ${adminUserId} assigned admin status to ${targetUserId}. Reason: ${reason || 'N/A'}`);

    return JSON.stringify({
      success: true,
      message: `Successfully assigned admin status to ${targetUserId}`,
      assignedBy: adminUserId,
      assignedTo: targetUserId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error assigning admin:", error);
    throw new Error(`Failed to assign admin: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

