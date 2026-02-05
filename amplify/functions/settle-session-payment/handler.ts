import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;
const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const DEFAULT_PLATFORM_MARKUP_PERCENT = 30;

/**
 * Settlement-only: create PartnerPayout and update Session from creditsDeductedSoFar.
 * Invoked by signaling when a teleop session ends (no user deduction; that already happened per-minute).
 */
export const handler = async (event: { sessionId?: string; arguments?: { sessionId?: string } }): Promise<{ statusCode: number; body: string }> => {
  const sessionId = event.sessionId ?? event.arguments?.sessionId;
  console.log('Settle session payment request:', { sessionId });

  if (!sessionId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing sessionId' }),
    };
  }

  try {
    const sessionResult = await docClient.send(
      new GetCommand({
        TableName: SESSION_TABLE_NAME,
        Key: { id: sessionId },
      })
    );
    const session = sessionResult.Item;
    if (!session) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: `Session not found: ${sessionId}` }),
      };
    }

    if (session.creditsCharged != null && session.creditsCharged > 0) {
      console.log('Payment already settled for session:', sessionId);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Payment already settled',
          sessionId,
          creditsCharged: session.creditsCharged,
        }),
      };
    }

    const creditsDeductedSoFar = Number(session.creditsDeductedSoFar) || 0;
    const robotId = session.robotId;
    const durationSeconds = session.durationSeconds ?? 0;

    if (creditsDeductedSoFar <= 0) {
      await docClient.send(
        new UpdateCommand({
          TableName: SESSION_TABLE_NAME,
          Key: { id: sessionId },
          UpdateExpression: 'SET creditsCharged = :credits, partnerEarnings = :earnings, platformFee = :fee, updatedAt = :now',
          ExpressionAttributeValues: {
            ':credits': 0,
            ':earnings': 0,
            ':fee': 0,
            ':now': new Date().toISOString(),
          },
        })
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No credits to settle (free or zero usage)',
          sessionId,
          creditsCharged: 0,
        }),
      };
    }

    let platformMarkupPercent = DEFAULT_PLATFORM_MARKUP_PERCENT;
    try {
      const settingsResult = await docClient.send(
        new QueryCommand({
          TableName: PLATFORM_SETTINGS_TABLE,
          IndexName: 'settingKeyIndex',
          KeyConditionExpression: 'settingKey = :key',
          ExpressionAttributeValues: { ':key': 'platformMarkupPercent' },
          Limit: 1,
        })
      );
      if (settingsResult.Items?.[0]?.settingValue) {
        platformMarkupPercent = parseFloat(settingsResult.Items[0].settingValue) || DEFAULT_PLATFORM_MARKUP_PERCENT;
      }
    } catch (err) {
      console.warn('Failed to get platform markup, using default:', err);
    }

    const totalCreditsCharged = creditsDeductedSoFar;
    const partnerEarningsCredits = totalCreditsCharged / (1 + platformMarkupPercent / 100);
    const platformFeeCredits = totalCreditsCharged - partnerEarningsCredits;

    const robotResult = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_TABLE_NAME,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        ExpressionAttributeValues: { ':robotId': robotId },
        Limit: 1,
      })
    );
    const robot = robotResult.Items?.[0];
    if (!robot) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: `Robot not found: ${robotId}` }),
      };
    }

    const robotName = session.robotName || robot.name || robotId;
    const partnerTableId = robot.partnerId;
    if (!partnerTableId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: `Robot has no partnerId: ${robotId}` }),
      };
    }

    const partnerResult = await docClient.send(
      new GetCommand({
        TableName: PARTNER_TABLE_NAME,
        Key: { id: partnerTableId },
      })
    );
    const partner = partnerResult.Item;
    const partnerCognitoUsername = partner?.cognitoUsername;
    if (!partnerCognitoUsername) {
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: `Partner not found or has no cognitoUsername: ${partnerTableId}` }),
      };
    }

    let partnerEmail: string | undefined;
    if (USER_POOL_ID) {
      try {
        const cognitoUser = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: partnerCognitoUsername,
          })
        );
        partnerEmail = cognitoUser.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
      } catch (e) {
        console.warn('Could not fetch partner email from Cognito:', e);
      }
    }

    const payoutId = randomUUID();
    const payoutItem: Record<string, unknown> = {
      id: payoutId,
      owner: partnerCognitoUsername,
      partnerId: partnerCognitoUsername,
      partnerEmail: partnerEmail ?? undefined,
      sessionId,
      robotId,
      robotName: robotName || robotId,
      creditsEarned: Math.round(partnerEarningsCredits),
      platformFee: Math.round(platformFeeCredits),
      totalCreditsCharged: Math.round(totalCreditsCharged),
      durationSeconds,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await docClient.send(
      new PutCommand({
        TableName: PARTNER_PAYOUT_TABLE,
        Item: payoutItem,
      })
    );

    await docClient.send(
      new UpdateCommand({
        TableName: SESSION_TABLE_NAME,
        Key: { id: sessionId },
        UpdateExpression: 'SET creditsCharged = :credits, partnerEarnings = :earnings, platformFee = :fee, updatedAt = :now',
        ExpressionAttributeValues: {
          ':credits': Math.round(totalCreditsCharged),
          ':earnings': Math.round(partnerEarningsCredits),
          ':fee': Math.round(platformFeeCredits),
          ':now': new Date().toISOString(),
        },
      })
    );

    console.log('Settled session payment:', {
      sessionId,
      creditsCharged: totalCreditsCharged,
      partnerEarnings: partnerEarningsCredits,
      platformFee: platformFeeCredits,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sessionId,
        creditsCharged: Math.round(totalCreditsCharged),
        partnerEarnings: Math.round(partnerEarningsCredits),
        platformFee: Math.round(platformFeeCredits),
      }),
    };
  } catch (error) {
    console.error('Error settling session payment:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    }
  }
};
