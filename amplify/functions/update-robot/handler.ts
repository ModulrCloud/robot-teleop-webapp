import { DynamoDBClient, UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

export const handler: Schema["updateRobotLambda"]["functionHandler"] = async (event) => {
  const { robotId, robotName, description, model, robotType, hourlyRateCredits, enableAccessControl, additionalAllowedUsers, imageUrl, city, state, country, latitude, longitude } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const hasGroups = "groups" in identity;

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

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

  const isAdminUser = hasGroups && identity.groups
    ? identity.groups.some((g: string) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN')
    : false;

  if (!isAdminUser) {
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

    if (partnerItem.id.S !== robotPartnerId) {
      throw new Error("Unauthorised: only the robot owner or admins can update robots");
    }
  }

  const now = new Date().toISOString();

  const updateExpressions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expressionAttributeValues: Record<string, any> = {};
  const expressionAttributeNames: Record<string, string> = {};

  if (robotName !== undefined && robotName !== null) {
    updateExpressions.push('#name = :name');
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = { S: robotName };
  }

  if (description !== undefined && description !== null) {
    updateExpressions.push('#description = :description');
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = { S: description };
  }

  if (model !== undefined && model !== null && model.trim() !== '') {
    updateExpressions.push('#model = :model');
    expressionAttributeNames['#model'] = 'model';
    expressionAttributeValues[':model'] = { S: model.trim() };
  }

  if (robotType !== undefined && robotType !== null && robotType.trim() !== '') {
    updateExpressions.push('#robotType = :robotType');
    expressionAttributeNames['#robotType'] = 'robotType';
    expressionAttributeValues[':robotType'] = { S: robotType.trim() };
  }

  if (hourlyRateCredits !== undefined && hourlyRateCredits !== null) {
    updateExpressions.push('#hourlyRateCredits = :hourlyRateCredits');
    expressionAttributeNames['#hourlyRateCredits'] = 'hourlyRateCredits';
    expressionAttributeValues[':hourlyRateCredits'] = { N: hourlyRateCredits.toString() };
  }

  // Update imageUrl if provided
  // If imageUrl is null, undefined, or empty string, remove it (use default robot image)
  if (imageUrl !== undefined) {
    if (imageUrl !== null && typeof imageUrl === 'string' && imageUrl.trim() !== '') {
      // Valid imageUrl - set it
      updateExpressions.push('#imageUrl = :imageUrl');
      expressionAttributeNames['#imageUrl'] = 'imageUrl';
      expressionAttributeValues[':imageUrl'] = { S: imageUrl.trim() };
    } else {
      // null, undefined, or empty string - remove imageUrl attribute (will use default based on model)
      updateExpressions.push('REMOVE #imageUrl');
      expressionAttributeNames['#imageUrl'] = 'imageUrl';
    }
  }

  if (city !== undefined && city !== null) {
    updateExpressions.push('#city = :city');
    expressionAttributeNames['#city'] = 'city';
    expressionAttributeValues[':city'] = { S: city };
  } else if (city === null) {
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

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = { S: now };

  if (enableAccessControl !== undefined) {
    if (enableAccessControl === true) {
      const ownerUsername = identity.username;
      const identityAny = identity as unknown as { email?: string; claims?: { email?: string } };
      const ownerEmail = identityAny.email || identityAny.claims?.email;
      
      const defaultAllowedUsers = [
        ownerUsername.toLowerCase().trim(),
        'chris@modulr.cloud',
        'mike@modulr.cloud',
      ];
      
      if (ownerEmail && ownerEmail.toLowerCase().trim() !== ownerUsername.toLowerCase().trim()) {
        defaultAllowedUsers.push(ownerEmail.toLowerCase().trim());
      }
      
      const additionalUsers = (additionalAllowedUsers || [])
        .filter((email): email is string => email != null && typeof email === 'string')
        .map((email: string) => email.trim().toLowerCase())
        .filter((email: string) => email.length > 0 && email.includes('@'));
      
      const allAllowedUsers = Array.from(new Set([...defaultAllowedUsers, ...additionalUsers]));
      
      updateExpressions.push('#allowedUsers = :allowedUsers');
      expressionAttributeNames['#allowedUsers'] = 'allowedUsers';
      expressionAttributeValues[':allowedUsers'] = { SS: allAllowedUsers };
    } else {
      updateExpressions.push('REMOVE #allowedUsers');
      expressionAttributeNames['#allowedUsers'] = 'allowedUsers';
    }
  }

  if (updateExpressions.length === 0) {
    throw new Error("No fields to update");
  }

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

  await ddbClient.send(new UpdateItemCommand({
    TableName: robotTableName,
    Key: { id: { S: robotId } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: 'ALL_NEW',
  }));

  const updatedRobot = {
    id: robotId,
    robotId: robotResult.Item.robotId?.S,
    name: robotName || robotResult.Item.name?.S,
    description: description !== undefined ? description : robotResult.Item.description?.S,
    model: model !== undefined ? model : robotResult.Item.model?.S,
    robotType: robotType !== undefined ? robotType : robotResult.Item.robotType?.S,
    imageUrl: imageUrl !== undefined ? imageUrl : robotResult.Item.imageUrl?.S,
    partnerId: robotPartnerId,
    updatedAt: now,
  };

  return JSON.stringify(updatedRobot);
};
