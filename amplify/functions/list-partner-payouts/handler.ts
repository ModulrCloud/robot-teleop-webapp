import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listPartnerPayoutsLambda"]["functionHandler"] = async (event) => {
  const { partnerId, robotId, status, limit = 50, nextToken } = event.arguments;
  const identity = event.identity;

  console.log("[listPartnerPayouts] request", {
    partnerId: event.arguments?.partnerId,
    robotId: event.arguments?.robotId,
    status: event.arguments?.status,
    limit: event.arguments?.limit,
    hasIdentity: !!identity,
    requesterUsername: identity && "username" in identity ? identity.username : undefined,
  });

  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  const requesterId = identity.username;
  let isAdmin = false;
  let isModulrEmployee = false;

  try {
    // Check if requester is admin or Modulr employee
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: requesterId,
      })
    );
    const groups = userResponse.UserAttributes?.find(attr => attr.Name === 'cognito:groups')?.Value;
    isAdmin = groups?.includes('ADMINS') || false;
    
    const email = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    isModulrEmployee = email?.toLowerCase().endsWith('@modulr.cloud') || false;
  } catch (error) {
    console.warn("Could not fetch user info:", error);
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Unauthorized: could not verify user" }),
    };
  }

  // Only admins or Modulr employees can view all payouts
  // Partners can only view their own payouts
  if (!isAdmin && !isModulrEmployee) {
    // If not admin, they can only query their own payouts
    if (!partnerId || partnerId !== requesterId) {
      console.log("[listPartnerPayouts] 403: partner must query own payouts", {
        requesterId,
        partnerIdFromArgs: partnerId,
        match: partnerId === requesterId,
      });
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: can only view own payouts" }),
      };
    }
  }

  console.log("[listPartnerPayouts] auth ok", { requesterId, isAdmin, isModulrEmployee, queryPartnerId: partnerId });

  try {
    let payouts: any[] = [];
    let lastEvaluatedKey: any = undefined;

    // If nextToken is provided, parse it
    if (nextToken) {
      try {
        lastEvaluatedKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      } catch (e) {
        console.warn("Invalid nextToken:", e);
      }
    }

    // Build query based on filters
    if (partnerId) {
      // Query by partnerId using index
      const queryParams: any = {
        TableName: PARTNER_PAYOUT_TABLE,
        IndexName: 'partnerIdIndex',
        KeyConditionExpression: 'partnerId = :partnerId',
        ExpressionAttributeValues: {
          ':partnerId': partnerId,
        },
        Limit: limit,
        ScanIndexForward: false, // Newest first
        ExclusiveStartKey: lastEvaluatedKey,
      };

      // Add status filter if provided
      if (status) {
        queryParams.FilterExpression = '#status = :status';
        queryParams.ExpressionAttributeNames = {
          '#status': 'status',
        };
        queryParams.ExpressionAttributeValues[':status'] = status;
      }

      const result = await docClient.send(new QueryCommand(queryParams));
      payouts = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
      console.log("[listPartnerPayouts] query by partnerId", {
        partnerId,
        itemsReturned: payouts.length,
        firstPayoutPartnerId: payouts[0]?.partnerId,
        firstPayoutRobotId: payouts[0]?.robotId,
      });
    } else if (status) {
      // Query by status using index (admin view)
      const queryParams: any = {
        TableName: PARTNER_PAYOUT_TABLE,
        IndexName: 'statusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: lastEvaluatedKey,
      };

      // Add robotId filter if provided
      if (robotId) {
        queryParams.FilterExpression = 'robotId = :robotId';
        queryParams.ExpressionAttributeValues[':robotId'] = robotId;
      }

      const result = await docClient.send(new QueryCommand(queryParams));
      payouts = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
    } else {
      // Scan all payouts (admin only)
      if (!isAdmin && !isModulrEmployee) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: must specify partnerId or status" }),
        };
      }

      const scanParams: any = {
        TableName: PARTNER_PAYOUT_TABLE,
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
      };

      // Add robotId filter if provided
      if (robotId) {
        scanParams.FilterExpression = 'robotId = :robotId';
        scanParams.ExpressionAttributeValues = {
          ':robotId': robotId,
        };
      }

      const result = await docClient.send(new ScanCommand(scanParams));
      payouts = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
    }

    // Convert credits to dollars for display (1 credit = $0.01)
    let payoutsWithDollars = payouts.map(payout => ({
      ...payout,
      creditsEarnedDollars: (payout.creditsEarned || 0) / 100,
      platformFeeDollars: (payout.platformFee || 0) / 100,
      totalCreditsChargedDollars: (payout.totalCreditsCharged || 0) / 100,
    }));

    // Enrich missing partnerEmail from Cognito (for older payouts or when write path didn't set it)
    const partnerIdsNeedingEmail = [...new Set(
      payoutsWithDollars
        .filter((p: any) => p.partnerId && !p.partnerEmail)
        .map((p: any) => p.partnerId)
    )];
    const partnerIdToEmail: Record<string, string> = {};
    for (const pid of partnerIdsNeedingEmail) {
      try {
        const userRes = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: pid,
          })
        );
        const email = userRes.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
        if (email) partnerIdToEmail[pid] = email;
      } catch (e) {
        console.warn('[listPartnerPayouts] Could not fetch email for partner:', pid, e);
      }
    }
    if (Object.keys(partnerIdToEmail).length > 0) {
      payoutsWithDollars = payoutsWithDollars.map((p: any) => ({
        ...p,
        partnerEmail: p.partnerEmail || partnerIdToEmail[p.partnerId] || p.partnerEmail,
      }));
    }

    // Generate nextToken
    let nextTokenOut: string | undefined = undefined;
    if (lastEvaluatedKey) {
      nextTokenOut = Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        payouts: payoutsWithDollars,
        nextToken: nextTokenOut,
      }),
    };
  } catch (error) {
    console.error("Error listing partner payouts:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to list partner payouts",
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

