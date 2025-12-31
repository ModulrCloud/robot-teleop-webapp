import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["processPayoutLambda"]["functionHandler"] = async (event) => {
  console.log("Process Payout request:", JSON.stringify(event, null, 2));

  const { payoutIds } = event.arguments;

  if (!payoutIds || !Array.isArray(payoutIds) || payoutIds.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required argument: payoutIds (array)" }),
    };
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  const adminUsername = identity.username;
  let isAdmin = false;
  let isModulrEmployee = false;
  let adminEmail: string | undefined;

  try {
    // Verify admin access
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: adminUsername,
      })
    );
    
    const groups = userResponse.UserAttributes?.find(attr => attr.Name === 'cognito:groups')?.Value;
    isAdmin = groups?.includes('ADMINS') || false;
    
    adminEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    isModulrEmployee = adminEmail?.toLowerCase().endsWith('@modulr.cloud') || false;

    if (!isAdmin && !isModulrEmployee) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: only ADMINS or Modulr employees can process payouts" }),
      };
    }
  } catch (error) {
    console.error("Could not verify admin access:", error);
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Unauthorized: could not verify admin access" }),
    };
  }

  try {
    // Fetch all payout records
    const payoutKeys = payoutIds.map(id => ({ id }));
    const batchGetResult = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [PARTNER_PAYOUT_TABLE]: {
            Keys: payoutKeys,
          },
        },
      })
    );

    const payouts = batchGetResult.Responses?.[PARTNER_PAYOUT_TABLE] || [];

    if (payouts.length !== payoutIds.length) {
      const foundIds = new Set(payouts.map(p => p.id));
      const missingIds = payoutIds.filter(id => !foundIds.has(id));
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: "Some payouts not found",
          missingIds,
        }),
      };
    }

    // Verify all payouts are in 'pending' status
    const invalidPayouts = payouts.filter(p => p.status !== 'pending');
    if (invalidPayouts.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: "Some payouts are not in 'pending' status",
          invalidPayouts: invalidPayouts.map(p => ({ id: p.id, status: p.status })),
        }),
      };
    }

    const payoutDate = new Date().toISOString();
    const processedPayouts: any[] = [];
    const errors: any[] = [];

    // Process each payout
    for (const payout of payouts) {
      try {
        // Update payout status to 'paid'
        await docClient.send(
          new UpdateCommand({
            TableName: PARTNER_PAYOUT_TABLE,
            Key: { id: payout.id },
            UpdateExpression: 'SET #status = :status, payoutDate = :payoutDate',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'paid',
              ':payoutDate': payoutDate,
            },
          })
        );

        // Create audit log entry
        if (ADMIN_AUDIT_TABLE) {
          try {
            await docClient.send(
              new PutCommand({
                TableName: ADMIN_AUDIT_TABLE,
                Item: {
                  id: randomUUID(),
                  action: 'PROCESS_PAYOUT',
                  adminUserId: adminUsername,
                  adminEmail: adminEmail || adminUsername,
                  targetUserId: payout.partnerId,
                  reason: `Processed payout for ${payout.robotName || payout.robotId}`,
                  timestamp: new Date().toISOString(),
                  metadata: {
                    payoutId: payout.id,
                    partnerId: payout.partnerId,
                    partnerEmail: payout.partnerEmail,
                    robotId: payout.robotId,
                    robotName: payout.robotName,
                    creditsEarned: payout.creditsEarned,
                    platformFee: payout.platformFee,
                    totalCreditsCharged: payout.totalCreditsCharged,
                    payoutDate,
                  },
                },
              })
            );
          } catch (auditError) {
            console.error(`Failed to create audit log for payout ${payout.id}:`, auditError);
            // Don't fail the payout processing if audit logging fails
          }
        }

        processedPayouts.push({
          id: payout.id,
          partnerId: payout.partnerId,
          partnerEmail: payout.partnerEmail,
          robotName: payout.robotName,
          creditsEarned: payout.creditsEarned,
          creditsEarnedDollars: (payout.creditsEarned || 0) / 100,
        });
      } catch (error) {
        console.error(`Error processing payout ${payout.id}:`, error);
        errors.push({
          payoutId: payout.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Calculate totals
    const totalCreditsEarned = processedPayouts.reduce((sum, p) => sum + (p.creditsEarned || 0), 0);
    const totalDollars = totalCreditsEarned / 100;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Processed ${processedPayouts.length} payout(s)`,
        processedCount: processedPayouts.length,
        totalCreditsEarned,
        totalDollars,
        processedPayouts,
        errors: errors.length > 0 ? errors : undefined,
      }),
    };
  } catch (error) {
    console.error("Error processing payouts:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to process payouts",
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};


