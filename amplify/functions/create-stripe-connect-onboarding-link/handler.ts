import type { Schema } from "../../data/resource";
import Stripe from "stripe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;

export const handler: Schema["createStripeConnectOnboardingLinkLambda"]["functionHandler"] = async (event) => {
  const { returnUrl, refreshUrl } = event.arguments;
  const identity = event.identity;

  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized");
  }
  if (!returnUrl || !refreshUrl) {
    throw new Error("returnUrl and refreshUrl are required");
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
      throw new Error("Partner not found");
    }

    let accountId = partner.stripeConnectAccountId as string | undefined;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: (partner.contactEmail as string) || undefined,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      await docClient.send(
        new UpdateCommand({
          TableName: PARTNER_TABLE_NAME,
          Key: { id: partner.id },
          UpdateExpression: "SET stripeConnectAccountId = :aid",
          ExpressionAttributeValues: { ":aid": accountId },
        })
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    if (!accountLink.url) {
      throw new Error("Stripe did not return an onboarding URL");
    }
    return JSON.stringify({ success: true, url: accountLink.url });
  } catch (err) {
    console.error("[createStripeConnectOnboardingLink]", err);
    throw new Error(err instanceof Error ? err.message : "Failed to create Stripe onboarding link");
  }
};
