import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SOCIAL_PROFILE_TABLE = process.env.SOCIAL_PROFILE_TABLE!;

export const handler: Schema["getSocialProfileLambda"]["functionHandler"] = async (event) => {
  console.log("=== GET SOCIAL PROFILE LAMBDA START ===");
  console.log("Event identity:", JSON.stringify(event.identity, null, 2));
  
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ success: false, error: "Unauthorized: must be logged in" }),
    };
  }

  const cognitoId = identity.username;
  console.log("Looking up profile for cognitoId:", cognitoId);

  try {
    // Query by cognitoId index
    const profileQuery = await docClient.send(
      new QueryCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        IndexName: 'cognitoIdIndex',
        KeyConditionExpression: 'cognitoId = :cognitoId',
        ExpressionAttributeValues: {
          ':cognitoId': cognitoId,
        },
        Limit: 1,
      })
    );

    console.log("Profile query result:", JSON.stringify(profileQuery, null, 2));

    if (!profileQuery.Items || profileQuery.Items.length === 0) {
      console.log("No profile found for user");
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          profile: null,
          message: "No profile found",
        }),
      };
    }

    const profile = profileQuery.Items[0];
    console.log("Found profile:", JSON.stringify(profile, null, 2));

    // Return the profile data (excluding sensitive fields)
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        profile: {
          id: profile.id,
          cognitoId: profile.cognitoId,
          username: profile.username,
          displayName: profile.displayName,
          avatar: profile.avatar,
          bio: profile.bio,
          role: profile.role,
          subscriptionStatus: profile.subscriptionStatus,
          subscriptionPlan: profile.subscriptionPlan,
          subscriptionStartedAt: profile.subscriptionStartedAt,
          subscriptionExpiresAt: profile.subscriptionExpiresAt,
          trialEndsAt: profile.trialEndsAt,
          pendingSubscriptionPlan: profile.pendingSubscriptionPlan,
          pendingSubscriptionStartsAt: profile.pendingSubscriptionStartsAt,
          isOgPricing: profile.isOgPricing,
          ogPriceMtrMonthly: profile.ogPriceMtrMonthly,
          ogPriceMtrAnnual: profile.ogPriceMtrAnnual,
          moderationStatus: profile.moderationStatus,
          tenureBadge: profile.tenureBadge,
          modulrAddress: profile.modulrAddress,
          createdAt: profile.createdAt,
        },
      }),
    };

  } catch (error) {
    console.error("Error fetching profile:", error);
    
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch profile",
        details: errorMessage,
      }),
    };
  }
};
