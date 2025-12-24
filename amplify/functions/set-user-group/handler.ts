import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();
const USER_POOL_ID: string = process.env.USER_POOL_ID!;

const GROUP_NAME_MAP: Record<string, string> = {
  client: "CLIENTS",
  partner: "PARTNERS",
};
const ALLOWED_GROUPS = Array.from(Object.keys(GROUP_NAME_MAP));

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
    
    // Also check email domain
    const identityAny = identity as any;
    const userEmail = identityAny.email || identityAny.claims?.email;
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
    // First, remove user from all existing groups (CLIENTS, PARTNERS)
    const groupsResponse = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );
    
    // Remove from CLIENTS and PARTNERS groups
    for (const userGroup of groupsResponse.Groups || []) {
      if (userGroup.GroupName === 'CLIENTS' || userGroup.GroupName === 'PARTNERS') {
        await cognito.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId,
            GroupName: userGroup.GroupName,
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

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `User ${userId} added to ${group}` }),
    };
  } catch (error) {
    console.error("Error adding user to group:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to add user to group" }),
    };
  }
}
