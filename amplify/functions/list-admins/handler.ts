import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listAdminsLambda"]["functionHandler"] = async (event) => {
  console.log("List Admins request:", JSON.stringify(event, null, 2));

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Get user email for domain-based access check
  const userEmail = (identity as any).email || (identity as any).claims?.email;
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  
  // Check if user is a Modulr employee (@modulr.cloud domain)
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    userEmail.toLowerCase().trim().endsWith('@modulr.cloud');
  
  // SECURITY: Only admins (ADMINS group) or Modulr employees can list other admins
  if (!isInAdminGroup && !isModulrEmployee) {
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can list admins");
  }

  try {
    // List all users in ADMINS group
    const adminsList = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: 'ADMINS',
      })
    );

    const admins = (adminsList.Users || []).map(user => ({
      username: user.Username,
      email: user.Attributes?.find(attr => attr.Name === 'email')?.Value,
      status: user.UserStatus,
      enabled: user.Enabled,
      createdAt: user.UserCreateDate?.toISOString(),
      lastModified: user.UserLastModifiedDate?.toISOString(),
    }));

    console.log(`Found ${admins.length} admins`);

    return JSON.stringify({
      success: true,
      count: admins.length,
      admins,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error listing admins:", error);
    throw new Error(`Failed to list admins: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

