import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, ListUsersCommand, AdminGetUserCommand, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;

export const handler: Schema["listUsersLambda"]["functionHandler"] = async (event) => {
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
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
  } catch {
    throw new Error("Unauthorized: could not verify user email");
  }

  if (!userEmail) {
    throw new Error("Unauthorized: user email not found");
  }

  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  const isModulrEmployee = userEmail.toLowerCase().trim().endsWith('@modulr.cloud');

  if (!isInAdminGroup && !isModulrEmployee) {
    throw new Error("Unauthorized: only ADMINS or Ctrl + R employees (@modulr.cloud) can list users");
  }

  const { limit = 50, paginationToken, search } = event.arguments || {};

  try {
    const listUsersParams: any = {
      UserPoolId: USER_POOL_ID,
      Limit: Math.min(limit || 50, 60),
    };

    if (paginationToken) {
      listUsersParams.PaginationToken = paginationToken;
    }

    // Cognito Filter supports: email, name, username, etc.
    // We use a prefix match on email when a search term is provided.
    if (search && search.trim()) {
      const q = search.trim().replace(/"/g, '\\"');
      listUsersParams.Filter = `email ^= "${q}"`;
    }

    const cognitoUsers = await cognito.send(new ListUsersCommand(listUsersParams));

    const GROUP_PRIORITY: Record<string, string> = {
      ADMINS: 'ADMIN',
      ORGANIZATIONS: 'ORGANIZATION',
      SERVICE_PROVIDERS: 'SERVICE_PROVIDER',
      PARTNERS: 'PARTNER',
      CLIENTS: 'CLIENT',
    };
    const PRIORITY_ORDER = Object.keys(GROUP_PRIORITY);

    const pageUsernames = (cognitoUsers.Users || [])
      .map((u) => u.Username)
      .filter(Boolean) as string[];

    // Classify only the users on this page via AdminListGroupsForUser
    // Process in batches of 10 to avoid Cognito throttling (25 req/s limit)
    const userGroups = new Map<string, string[]>();
    for (let i = 0; i < pageUsernames.length; i += 10) {
      const batch = pageUsernames.slice(i, i + 10);
      await Promise.all(
        batch.map(async (username) => {
          try {
            const resp = await cognito.send(
              new AdminListGroupsForUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: username,
              })
            );
            userGroups.set(
              username,
              (resp.Groups || []).map((g) => g.GroupName!).filter(Boolean)
            );
          } catch {
            userGroups.set(username, []);
          }
        })
      );
    }

    const classifyUser = (username: string): string => {
      const groups = userGroups.get(username) || [];
      for (const g of PRIORITY_ORDER) {
        if (groups.includes(g)) return GROUP_PRIORITY[g];
      }
      return 'CLIENT';
    };

    // Fetch credit balances for page users via GSI queries (userId is not the PK)
    const creditsByUserId = new Map<string, number>();
    for (let i = 0; i < pageUsernames.length; i += 10) {
      const batch = pageUsernames.slice(i, i + 10);
      await Promise.all(
        batch.map(async (uid) => {
          try {
            const resp = await docClient.send(
              new QueryCommand({
                TableName: USER_CREDITS_TABLE,
                IndexName: 'userIdIndex',
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': uid },
                ProjectionExpression: 'userId, credits',
                Limit: 1,
              })
            );
            const item = resp.Items?.[0];
            if (item) {
              creditsByUserId.set(uid, (item.credits as number) || 0);
            }
          } catch {
            // skip — user may not have a credits record yet
          }
        })
      );
    }

    const usersWithCredits = (cognitoUsers.Users || []).map((cognitoUser) => {
      const username = cognitoUser.Username || '';
      const email = cognitoUser.Attributes?.find(attr => attr.Name === 'email')?.Value || '';
      const name = cognitoUser.Attributes?.find(attr => attr.Name === 'name')?.Value || '';

      return {
        username,
        email,
        name: name || email?.split('@')[0] || username,
        credits: creditsByUserId.get(username) || 0,
        classification: classifyUser(username),
        status: cognitoUser.UserStatus,
        enabled: cognitoUser.Enabled,
        createdAt: cognitoUser.UserCreateDate?.toISOString(),
        lastModified: cognitoUser.UserLastModifiedDate?.toISOString(),
        groups: cognitoUser.Attributes?.find(attr => attr.Name === 'custom:groups')?.Value || '',
      };
    });

    // Return pagination token if there are more users
    const nextToken = cognitoUsers.PaginationToken || null;

    return JSON.stringify({
      success: true,
      users: usersWithCredits,
      count: usersWithCredits.length,
      nextToken,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error listing users:", error);
    throw new Error(`Failed to list users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

