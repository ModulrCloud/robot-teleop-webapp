import type { Schema } from "../../data/resource";
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CREDIT_TIER_TABLE = process.env.CREDIT_TIER_TABLE!;

export const handler: Schema["createStripeCheckoutLambda"]["functionHandler"] = async (event) => {
  const { tierId, userId } = event.arguments;

  if (!tierId || !userId) {
    throw new Error("Missing required arguments: tierId and userId");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  if (identity.username !== userId) {
    throw new Error("Unauthorized: userId does not match authenticated user");
  }

  try {
    const queryResponse = await docClient.send(
      new QueryCommand({
        TableName: CREDIT_TIER_TABLE,
        IndexName: 'tierIdIndex',
        KeyConditionExpression: 'tierId = :tierId',
        ExpressionAttributeValues: {
          ':tierId': tierId,
        },
        Limit: 1,
      })
    );

    const tierRecord = queryResponse.Items?.[0];
    
    if (!tierRecord) {
      throw new Error(`Tier not found: ${tierId}`);
    }

    if (tierRecord.isActive === false) {
      throw new Error(`Tier is not active: ${tierId}`);
    }

    const now = new Date().toISOString();
    const isSaleActive = tierRecord.isOnSale === true &&
      tierRecord.salePrice != null &&
      (!tierRecord.saleStartDate || tierRecord.saleStartDate <= now) &&
      (!tierRecord.saleEndDate || tierRecord.saleEndDate >= now);

    const finalPrice = isSaleActive ? tierRecord.salePrice : tierRecord.basePrice;
    const totalCredits = tierRecord.baseCredits + 
      (isSaleActive && tierRecord.saleBonusCredits ? tierRecord.saleBonusCredits : 0) +
      (tierRecord.bonusCredits || 0);

    const tier = {
      name: tierRecord.name,
      price: finalPrice,
      credits: tierRecord.baseCredits,
      bonusCredits: (isSaleActive && tierRecord.saleBonusCredits ? tierRecord.saleBonusCredits : 0) + (tierRecord.bonusCredits || 0),
    };

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: tier.name,
              description: `Get ${totalCredits.toLocaleString()} credits`,
            },
            unit_amount: Math.round(tier.price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
        tierId: tierId,
        credits: totalCredits.toString(),
        amountPaid: finalPrice.toString(),
        currency: 'USD',
      },
      success_url: `${frontendUrl}/credits?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/credits?canceled=true`,
    });

    if (!session.url) {
      throw new Error("Stripe session created but no checkout URL returned");
    }

    return JSON.stringify({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to create checkout session: ${errorMessage}`);
  }
};

