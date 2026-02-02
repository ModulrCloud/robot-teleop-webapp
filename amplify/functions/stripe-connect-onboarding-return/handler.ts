import type { Schema } from "../../data/resource";
import Stripe from "stripe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;

export const handler: Schema["stripeConnectOnboardingReturnLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;

  if (!identity || !("username" in identity)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const cognitoUsername = identity.username;

  try {
    const partnerResult = await docClient.send(
      new QueryCommand({
        TableName: PARTNER_TABLE_NAME,
        IndexName: "cognitoUsernameIndex",
        KeyConditionExpression: "cognitoUsername = :cognitoUsername",
        ExpressionAttributeValues: { ":cognitoUsername": cognitoUsername },
        Limit: 1,
      })
    );
    const partner = partnerResult.Items?.[0];
    if (!partner?.id) {
      return { statusCode: 404, body: JSON.stringify({ error: "Partner not found" }) };
    }

    const accountId = partner.stripeConnectAccountId as string | undefined;
    if (!accountId) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, onboardingComplete: false }),
      };
    }

    const account = await stripe.accounts.retrieve(accountId);
    const detailsSubmitted = account.details_submitted === true;
    const chargesEnabled = account.charges_enabled === true;
    const onboardingComplete = detailsSubmitted && chargesEnabled;

    await docClient.send(
      new UpdateCommand({
        TableName: PARTNER_TABLE_NAME,
        Key: { id: partner.id },
        UpdateExpression: "SET stripeConnectOnboardingComplete = :complete",
        ExpressionAttributeValues: { ":complete": onboardingComplete },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, onboardingComplete }),
    };
  } catch (err) {
    console.error("[stripeConnectOnboardingReturn]", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to check onboarding status",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
