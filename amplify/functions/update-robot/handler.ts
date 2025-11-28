import { DynamoDBClient, UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

export const handler: Schema["updateRobotLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { robotId, robotName, description, model, enableAccessControl, additionalAllowedUsers, city, state, country, latitude, longitude } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  // Type guard: check if identity has groups (Cognito identity)
  const hasGroups = "groups" in identity;

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Get the robot to verify ownership
  const robotResult = await ddbClient.send(
    new GetItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robotId } },
    })
  );

  if (!robotResult.Item) {
    throw new Error(`Robot with ID ${robotId} not found`);
  }

  const robotPartnerId = robotResult.Item.partnerId?.S;
  if (!robotPartnerId) {
    throw new Error("Robot has no partnerId - data corruption detected");
  }

  // Check if user is an admin
  const isAdminUser = hasGroups && identity.groups
    ? identity.groups.some((g: string) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN')
    : false;

  // If not admin, verify the requester is the robot owner
  if (!isAdminUser) {
    // Lookup the Partner record for this user
    const partnerQuery = await ddbClient.send(
      new QueryCommand({
        TableName: partnerTableName,
        IndexName: "cognitoUsernameIndex",
        KeyConditionExpression: "cognitoUsername = :username",
        ExpressionAttributeValues: {
          ":username": { S: identity.username },
        },
        Limit: 1,
      })
    );

    const partnerItem = partnerQuery.Items?.[0];
    if (!partnerItem || !partnerItem.id?.S) {
      throw new Error("No Partner found for this user");
    }
    const requesterPartnerId = partnerItem.id.S;

    if (requesterPartnerId !== robotPartnerId) {
      throw new Error("Unauthorised: only the robot owner or admins can update robots");
    }
  }

  // Get current timestamp for updatedAt
  const now = new Date().toISOString();

  // Build update expression
  const updateExpressions: string[] = [];
  const expressionAttributeValues: Record<string, any> = {};
  const expressionAttributeNames: Record<string, string> = {};

  // Update name if provided
  if (robotName !== undefined && robotName !== null) {
    updateExpressions.push('#name = :name');
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = { S: robotName };
  }

  // Update description if provided
  if (description !== undefined && description !== null) {
    updateExpressions.push('#description = :description');
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = { S: description };
  }

  // Update model if provided and not empty
  if (model !== undefined && model !== null && model.trim() !== '') {
    updateExpressions.push('#model = :model');
    expressionAttributeNames['#model'] = 'model';
    expressionAttributeValues[':model'] = { S: model.trim() };
  }

  // Update location fields if provided
  if (city !== undefined && city !== null) {
    updateExpressions.push('#city = :city');
    expressionAttributeNames['#city'] = 'city';
    expressionAttributeValues[':city'] = { S: city };
  } else if (city === null) {
    // Remove city if explicitly set to null
    updateExpressions.push('REMOVE #city');
    expressionAttributeNames['#city'] = 'city';
  }

  if (state !== undefined && state !== null) {
    updateExpressions.push('#state = :state');
    expressionAttributeNames['#state'] = 'state';
    expressionAttributeValues[':state'] = { S: state };
  } else if (state === null) {
    updateExpressions.push('REMOVE #state');
    expressionAttributeNames['#state'] = 'state';
  }

  if (country !== undefined && country !== null) {
    updateExpressions.push('#country = :country');
    expressionAttributeNames['#country'] = 'country';
    expressionAttributeValues[':country'] = { S: country };
  } else if (country === null) {
    updateExpressions.push('REMOVE #country');
    expressionAttributeNames['#country'] = 'country';
  }

  if (latitude !== undefined && latitude !== null) {
    updateExpressions.push('#latitude = :latitude');
    expressionAttributeNames['#latitude'] = 'latitude';
    expressionAttributeValues[':latitude'] = { N: latitude.toString() };
  } else if (latitude === null) {
    updateExpressions.push('REMOVE #latitude');
    expressionAttributeNames['#latitude'] = 'latitude';
  }

  if (longitude !== undefined && longitude !== null) {
    updateExpressions.push('#longitude = :longitude');
    expressionAttributeNames['#longitude'] = 'longitude';
    expressionAttributeValues[':longitude'] = { N: longitude.toString() };
  } else if (longitude === null) {
    updateExpressions.push('REMOVE #longitude');
    expressionAttributeNames['#longitude'] = 'longitude';
  }

  // Always update updatedAt
  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = { S: now };

  // Handle ACL updates
  if (enableAccessControl !== undefined) {
    if (enableAccessControl === true) {
      // Create or update ACL
      const ownerUsername = identity.username;
      const ownerEmail = (identity as any).email || (identity as any).claims?.email;
      
      const defaultAllowedUsers = [
        ownerUsername.toLowerCase().trim(),
        'chris@modulr.cloud',
        'mike@modulr.cloud',
      ];
      
      // Also add owner's email if it's different from username
      if (ownerEmail && ownerEmail.toLowerCase().trim() !== ownerUsername.toLowerCase().trim()) {
        defaultAllowedUsers.push(ownerEmail.toLowerCase().trim());
      }
      
      // Add any additional users provided (normalize to lowercase)
      const additionalUsers = (additionalAllowedUsers || [])
        .filter((email): email is string => email != null && typeof email === 'string')
        .map((email: string) => email.trim().toLowerCase())
        .filter((email: string) => email.length > 0 && email.includes('@'));
      
      // Combine defaults with additional users, removing duplicates
      const allAllowedUsers = Array.from(new Set([...defaultAllowedUsers, ...additionalUsers]));
      
      updateExpressions.push('#allowedUsers = :allowedUsers');
      expressionAttributeNames['#allowedUsers'] = 'allowedUsers';
      expressionAttributeValues[':allowedUsers'] = { SS: allAllowedUsers };
    } else {
      // Remove ACL (make robot open access)
      updateExpressions.push('REMOVE #allowedUsers');
      expressionAttributeNames['#allowedUsers'] = 'allowedUsers';
    }
  }

  if (updateExpressions.length === 0) {
    throw new Error("No fields to update");
  }

  // Separate SET and REMOVE expressions
  const setExpressions = updateExpressions.filter(expr => !expr.startsWith('REMOVE '));
  const removeExpressions = updateExpressions.filter(expr => expr.startsWith('REMOVE ')).map(expr => expr.replace('REMOVE ', ''));

  let updateExpression = '';
  if (setExpressions.length > 0) {
    updateExpression += 'SET ' + setExpressions.join(', ');
  }
  if (removeExpressions.length > 0) {
    if (updateExpression) updateExpression += ' ';
    updateExpression += 'REMOVE ' + removeExpressions.join(', ');
  }

  const updateItemInput: any = {
    TableName: robotTableName,
    Key: { id: { S: robotId } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: 'ALL_NEW',
  };

  console.log('📝 Updating robot in DynamoDB:', {
    robotId,
    updateExpression,
    expressionAttributeNames,
    expressionAttributeValues: Object.keys(expressionAttributeValues),
  });

  const result = await ddbClient.send(new UpdateItemCommand(updateItemInput));

  console.log('✅ Robot successfully updated in DynamoDB:', robotId);

  // Return the updated robot data
  const updatedRobot = {
    id: robotId,
    robotId: robotResult.Item.robotId?.S,
    name: robotName || robotResult.Item.name?.S,
    description: description !== undefined ? description : robotResult.Item.description?.S,
    model: model !== undefined ? model : robotResult.Item.model?.S,
    partnerId: robotPartnerId,
    updatedAt: now,
  };

  return JSON.stringify(updatedRobot);
};

