import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createAuditLog } from '../shared/audit-log';

const cognito = new CognitoIdentityProviderClient();
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const USER_POOL_ID: string = process.env.USER_POOL_ID!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE;

const GROUP_NAME_MAP: Record<string, string> = {
  client: "CLIENTS",
  partner: "PARTNERS",
  service_provider: "SERVICE_PROVIDERS",
  organization: "ORGANIZATIONS",
};
const ALLOWED_GROUPS = Array.from(Object.keys(GROUP_NAME_MAP));
const CLASSIFICATION_GROUPS = ["ORGANIZATIONS", "SERVICE_PROVIDERS", "PARTNERS", "CLIENTS"];

export const handler: Schema["setUserGroupLambda"]["functionHandler"] = async (event) => {
  console.log("Request event:", event);
  
  const { group, targetUsername } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  // If targetUsername is provided, check if caller is admin
  let userId = identity.username;
  let isAdmin: boolean = false;
  
  if (targetUsername) {
    // Check if caller is admin (ADMINS group or @modulr.cloud email)
    const adminGroups = "groups" in identity ? identity.groups : [];
    isAdmin = (adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN")) ?? false;
    
    // Also check email domain - fetch from Cognito to be sure
    let userEmail: string | undefined;
    try {
      const userResponse = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: identity.username,
        })
      );
      userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    } catch (error) {
      console.warn("Could not fetch email from Cognito:", error);
    }
    
    if (userEmail && typeof userEmail === 'string' && userEmail.toLowerCase().trim().endsWith('@modulr.cloud')) {
      isAdmin = true;
    }
    
    if (!isAdmin) {
      return { statusCode: 403, body: JSON.stringify({ error: "Only admins can change other users' groups" }) };
    }
    
    userId = targetUsername;
  }

  if (!userId || !group) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing user ID or group name" }) };
  }
  if (!ALLOWED_GROUPS.includes(group)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid requested group name" }) };
  }

  const groupName = GROUP_NAME_MAP[group];

  try {
    // First, get current groups to track the change
    const groupsResponse = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );
    
    const oldGroups = groupsResponse.Groups || [];
    const oldGroup = oldGroups.find(g => CLASSIFICATION_GROUPS.includes(g.GroupName!));
    const oldClassification = oldGroup?.GroupName || null;
    
    for (const userGroup of oldGroups) {
      if (CLASSIFICATION_GROUPS.includes(userGroup.GroupName!)) {
        await cognito.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId,
            GroupName: userGroup.GroupName!,
          })
        );
      }
    }

    // Add to the new group
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
        GroupName: groupName,
      })
    );

    // Create audit log entry if admin changed another user's classification
    if (isAdmin && targetUsername) {
      const adminUserId = identity.username;
      await createAuditLog(docClient, {
        action: 'CHANGE_USER_CLASSIFICATION',
        adminUserId,
        targetUserId: userId,
        reason: `Changed user classification from ${oldClassification || 'none'} to ${groupName}`,
        metadata: {
          oldGroup: oldClassification,
          newGroup: groupName,
        },
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `User ${userId} added to ${groupName}`,
        oldGroup: oldClassification,
        newGroup: groupName,
      }),
    };
  } catch (error) {
    console.error("Error adding user to group:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to add user to group",
        details: errorMessage,
      }),
    };
  }
}
