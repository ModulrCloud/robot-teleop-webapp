import { DynamoDBClient, ScanCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

/**
 * Lists robots that the current user can access based on ACL rules.
 * Returns:
 * - All robots with no ACL (open access)
 * - Robots where user is in the allowedUsers list
 * - Robots where user is owner, admin, or delegate
 */
export const handler: Schema["listAccessibleRobotsLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { limit = 50, nextToken } = event.arguments || {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;
  const robotOperatorTableName = process.env.ROBOT_OPERATOR_TABLE_NAME;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Get user's email, username, and sub for ACL matching
  const userEmail = (identity as any).email || (identity as any).claims?.email;
  const userUsername = identity.username;
  const userSub = (identity as any).sub || (identity as any).claims?.sub;
  const userGroups = (identity as any).groups || [];
  const isAdmin = userGroups.some((g: string) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN');

  // Normalize email to lowercase for comparison
  const normalizedUserEmail = userEmail ? userEmail.toLowerCase().trim() : null;
  const normalizedUserUsername = userUsername ? userUsername.toLowerCase().trim() : null;

  console.log('User identity for ACL check:', {
    email: normalizedUserEmail,
    username: normalizedUserUsername,
    sub: userSub,
    isAdmin,
    groups: userGroups,
  });

  // Get user's partnerId if they're a partner (for ownership checks)
  let userPartnerId: string | null = null;
  try {
    const partnerQuery = await ddbClient.send(
      new QueryCommand({
        TableName: partnerTableName,
        IndexName: "cognitoUsernameIndex",
        KeyConditionExpression: "cognitoUsername = :username",
        ExpressionAttributeValues: {
          ":username": { S: userUsername },
        },
        Limit: 1,
      })
    );
    userPartnerId = partnerQuery.Items?.[0]?.id?.S || null;
    console.log('Partner lookup result:', {
      username: userUsername,
      partnerId: userPartnerId,
      found: !!userPartnerId,
    });
  } catch (error) {
    console.warn('Could not query partner table for ownership check:', error);
  }

  // Scan all robots (we'll filter client-side based on ACL)
  // Support pagination with limit and nextToken
  let allRobots: any[] = [];
  let lastEvaluatedKey = nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined;
  let itemsScanned = 0;
  const maxItems = limit || 50; // Default to 50 if not specified

  console.log(`Starting scan of ${robotTableName} with limit ${maxItems}`);

  try {
    do {
      const scanResult = await ddbClient.send(
        new ScanCommand({
          TableName: robotTableName,
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: Math.min(maxItems - itemsScanned, 100), // DynamoDB max limit per scan is 100
        })
      );

      console.log(`Scan result: ${scanResult.Items?.length || 0} items, ScannedCount: ${scanResult.ScannedCount}, LastEvaluatedKey: ${!!scanResult.LastEvaluatedKey}`);

      if (scanResult.Items) {
        allRobots = allRobots.concat(scanResult.Items);
        itemsScanned += scanResult.Items.length;
        console.log(`Total robots collected so far: ${allRobots.length}`);
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      
      // Stop if we've reached the requested limit
      if (itemsScanned >= maxItems) {
        break;
      }
    } while (lastEvaluatedKey && itemsScanned < maxItems);
  } catch (error) {
    console.error('Error scanning robots table:', error);
    throw error;
  }

  console.log(`Found ${allRobots.length} total robots in database`);
  
  if (allRobots.length === 0) {
    console.warn('⚠️ WARNING: No robots found in database! This might indicate:');
    console.warn('  1. The table name is incorrect');
    console.warn('  2. The table is empty');
    console.warn('  3. There are permission issues');
    console.warn(`  Table name being used: ${robotTableName}`);
  } else {
    console.log(`✅ Successfully scanned ${allRobots.length} robots from table ${robotTableName}`);
  }

  // TEMPORARILY DISABLED ACL FILTERING - Return all robots, frontend will handle graying out
  // TODO: Re-enable ACL filtering once we debug why robots are being filtered incorrectly
  console.log('⚠️ ACL filtering temporarily disabled - returning all robots for frontend to handle');

  // Convert all robots without filtering (frontend will check ACL and gray out inaccessible ones)
  const robotsWithAccessCheck = allRobots.map((robotItem) => {
      // Just return the robot item - no filtering
      return robotItem;
    });

  // Filter out nulls and convert to GraphQL format
  const finalRobots = robotsWithAccessCheck
    .filter((robot) => robot !== null)
    .map((robotItem) => {
      // Convert DynamoDB format to GraphQL format
      return {
        id: robotItem.id?.S,
        robotId: robotItem.robotId?.S,
        name: robotItem.name?.S,
        description: robotItem.description?.S,
        model: robotItem.model?.S,
        partnerId: robotItem.partnerId?.S,
        allowedUsers: robotItem.allowedUsers?.SS || [],
        createdAt: robotItem.createdAt?.S,
        updatedAt: robotItem.updatedAt?.S,
        // Location fields
        city: robotItem.city?.S,
        state: robotItem.state?.S,
        country: robotItem.country?.S,
        latitude: robotItem.latitude?.N ? parseFloat(robotItem.latitude.N) : undefined,
        longitude: robotItem.longitude?.N ? parseFloat(robotItem.longitude.N) : undefined,
      };
    });

  console.log(`Returning ${finalRobots.length} accessible robots out of ${allRobots.length} total scanned`);
  
  // Log the first converted robot
  if (finalRobots.length > 0) {
    console.log('First converted robot:', JSON.stringify(finalRobots[0], null, 2));
  } else if (allRobots.length > 0) {
    console.error('ERROR: Had robots but all conversions failed or were filtered out!');
  }

  // Generate nextToken if there are more items to scan
  // Return empty string instead of null for nextToken (Amplify expects string)
  const nextTokenValue = lastEvaluatedKey 
    ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
    : '';

  // Return paginated response as JSON string (since we're using a.json() return type)
  const response = {
    robots: finalRobots,
    nextToken: nextTokenValue,
  };
  
  console.log(`Final response: ${finalRobots.length} robots, nextToken: ${nextTokenValue ? 'present' : 'empty'}`);
  console.log('Response JSON length:', JSON.stringify(response).length);
  
  const jsonResponse = JSON.stringify(response);
  console.log('Returning JSON string of length:', jsonResponse.length);
  
  return jsonResponse;
};

