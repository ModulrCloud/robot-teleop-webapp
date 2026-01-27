import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const PROMO_CODE_TABLE = process.env.PROMO_CODE_TABLE!;

/**
 * Validates a promo code and returns discount information if valid
 * 
 * Returns:
 * - valid: boolean
 * - reason?: string (if invalid)
 * - usernameDiscountPercent?: number (if valid)
 * - trialMonths?: number (if valid)
 */
export const handler: Schema["validatePromoCodeLambda"]["functionHandler"] = async (event) => {
  console.log("=== VALIDATE PROMO CODE LAMBDA START ===");
  console.log("Event:", JSON.stringify(event, null, 2));

  const { code } = event.arguments;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        valid: false,
        reason: 'Code is required',
      }),
    };
  }

  // Normalize code to uppercase
  const normalizedCode = code.trim().toUpperCase();

  try {
    // Query for promo code by code field
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: PROMO_CODE_TABLE,
        IndexName: 'codeIndex',
        KeyConditionExpression: 'code = :code',
        ExpressionAttributeValues: {
          ':code': normalizedCode,
        },
        Limit: 1,
      })
    );

    const promoCode = queryResult.Items?.[0];

    if (!promoCode) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          valid: false,
          reason: 'Code not found',
        }),
      };
    }

    // Check if code is active
    if (promoCode.isActive === false) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          valid: false,
          reason: 'Code is no longer active',
        }),
      };
    }

    // Check start date
    const now = new Date();
    if (promoCode.startsAt) {
      const startsAt = new Date(promoCode.startsAt);
      if (now < startsAt) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            valid: false,
            reason: 'Code is not yet active',
          }),
        };
      }
    }

    // Check expiration date
    if (promoCode.expiresAt) {
      const expiresAt = new Date(promoCode.expiresAt);
      if (now > expiresAt) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            valid: false,
            reason: 'Code has expired',
          }),
        };
      }
    }

    // Check usage limits
    if (promoCode.maxUses && typeof promoCode.maxUses === 'number') {
      const usedCount = promoCode.usedCount || 0;
      if (usedCount >= promoCode.maxUses) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            valid: false,
            reason: 'Code has reached maximum uses',
          }),
        };
      }
    }

    // Code is valid - return discount information
    return {
      statusCode: 200,
      body: JSON.stringify({
        valid: true,
        usernameDiscountPercent: promoCode.usernameDiscountPercent || 0,
        trialMonths: promoCode.trialMonths || 0,
      }),
    };

  } catch (error) {
    console.error("Error validating promo code:", error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        valid: false,
        reason: 'Failed to validate code',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
