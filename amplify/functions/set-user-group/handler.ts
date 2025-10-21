import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();
const USER_POOL_ID: string = process.env.USER_POOL_ID!;

const GROUP_NAME_MAP: Record<string, string> = {
  client: "CLIENTS",
  partner: "PARTNERS",
};
const ALLOWED_GROUPS = Array.from(Object.keys(GROUP_NAME_MAP));

export const handler: Schema["setUserGroup"]["functionHandler"] = async (event) => {
  console.log("Request event:", event);
  
  const { group } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const userId = identity.username;

  if (!userId || !group) {
    return { statusCode: 400, body: "Missing user ID or group name" };
  }
  if (!ALLOWED_GROUPS.includes(group)) {
    return { statusCode: 400, body: "Invalid requested group name" };
  }

  const groupName = GROUP_NAME_MAP[group];

  try {

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
