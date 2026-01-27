import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, AdminListGroupsForUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createAuditLog } from '../shared/audit-log';

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
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  
  // Get user email for super admin check
  // In GraphQL Lambda resolvers, email is typically not in identity directly
  // Always fetch from Cognito using the username to ensure we have the email
  let userEmail: string | undefined;
  
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    console.log("Fetched email from Cognito:", userEmail, "for username:", identity.username);
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    // If we can't get the email, we can't verify super admin status, so deny
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    console.error("No email found for user:", identity.username);
    throw new Error("Unauthorized: user email not found");
  }
  
  const normalizedEmail = userEmail.toLowerCase().trim();
  
  // Super admin: chris@modulr.cloud can always assign admins (solves chicken-and-egg problem)
  const SUPER_ADMIN_EMAIL = 'chris@modulr.cloud';
  const isSuperAdmin = normalizedEmail === SUPER_ADMIN_EMAIL;

  // SECURITY: Only super admin (chris@modulr.cloud) or existing ADMINS group members can assign admin status
  if (!isInAdminGroup && !isSuperAdmin) {
    throw new Error("Unauthorized: only super admin or ADMINS group members can assign admin status");
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
    await createAuditLog(docClient, {
      action: 'ASSIGN_ADMIN',
      adminUserId,
      targetUserId,
      reason: reason || undefined,
      metadata: {
        adminGroups: adminGroups || [],
        isSuperAdmin: isSuperAdmin,
        adminEmail: normalizedEmail || undefined,
      },
    });

    const adminType = isSuperAdmin ? 'Super Admin' : 'Admin';
    console.log(`${adminType} ${adminUserId} (${normalizedEmail || 'N/A'}) assigned admin status to ${targetUserId}. Reason: ${reason || 'N/A'}`);

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

