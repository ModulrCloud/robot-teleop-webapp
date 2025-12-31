import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const CREDIT_TIER_TABLE = process.env.CREDIT_TIER_TABLE!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["manageCreditTierLambda"]["functionHandler"] = async (event) => {
  console.log("Manage Credit Tier request:", JSON.stringify(event, null, 2));
  
  const { action, tierData: tierDataRaw, tierId } = event.arguments;

  // Parse tierData if it's a JSON string, otherwise use as-is
  // tierData comes as a.json() which can be string | number | boolean | object | array
  let tierData: any;
  if (typeof tierDataRaw === 'string') {
    try {
      tierData = JSON.parse(tierDataRaw);
    } catch {
      throw new Error("Invalid tierData: must be valid JSON");
    }
  } else if (typeof tierDataRaw === 'object' && tierDataRaw !== null) {
    tierData = tierDataRaw;
  } else {
    throw new Error("Invalid tierData: must be an object");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Get user email for domain-based access check
  let userEmail: string | undefined;
  
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    console.log("Fetched email from Cognito:", userEmail, "for username:", identity.username);
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    throw new Error("Unauthorized: user email not found");
  }

  // Check if user is admin (ADMINS group or @modulr.cloud email)
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    userEmail.toLowerCase().trim().endsWith('@modulr.cloud');
  
  // SECURITY: Only admins or Modulr employees can manage credit tiers
  if (!isInAdminGroup && !isModulrEmployee) {
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can manage credit tiers");
  }

  try {
    const now = new Date().toISOString();

    switch (action) {
      case 'create': {
        if (!tierData) {
          throw new Error("Missing required argument: tierData");
        }

        const item = {
          id: (tierData as any).id || randomUUID(),
          tierId: (tierData as any).tierId,
          name: (tierData as any).name,
          basePrice: (tierData as any).basePrice,
          baseCredits: (tierData as any).baseCredits,
          bonusCredits: (tierData as any).bonusCredits || 0,
          isActive: (tierData as any).isActive !== false,
          isOnSale: (tierData as any).isOnSale || false,
          salePrice: (tierData as any).salePrice || null,
          saleBonusCredits: (tierData as any).saleBonusCredits || null,
          saleStartDate: (tierData as any).saleStartDate || null,
          saleEndDate: (tierData as any).saleEndDate || null,
          description: (tierData as any).description || null,
          displayOrder: (tierData as any).displayOrder || 0,
          createdAt: (tierData as any).createdAt || now,
          updatedAt: now,
        };

        await docClient.send(
          new PutCommand({
            TableName: CREDIT_TIER_TABLE,
            Item: item,
          })
        );

        // Create audit log entry
        await docClient.send(
          new PutCommand({
            TableName: ADMIN_AUDIT_TABLE,
            Item: {
              id: randomUUID(),
              action: 'CREATE_CREDIT_TIER',
              adminUserId: identity.username,
              reason: item.description || null,
              timestamp: now,
              metadata: {
                tierId: item.tierId,
                tierName: item.name,
                basePrice: item.basePrice,
                baseCredits: item.baseCredits,
                bonusCredits: item.bonusCredits,
              },
            },
          })
        );

        return JSON.stringify({
          success: true,
          data: item,
        });
      }

      case 'update': {
        if (!tierId || !tierData) {
          throw new Error("Missing required arguments: tierId and tierData");
        }

        // First, get the existing tier to preserve createdAt
        const getResult = await docClient.send(
          new GetCommand({
            TableName: CREDIT_TIER_TABLE,
            Key: { id: tierId },
          })
        );

        if (!getResult.Item) {
          throw new Error(`Tier not found: ${tierId}`);
        }

        const updateExpression: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        const tier = tierData as any;
        if (tier.tierId !== undefined) {
          updateExpression.push('#tierId = :tierId');
          expressionAttributeNames['#tierId'] = 'tierId';
          expressionAttributeValues[':tierId'] = tier.tierId;
        }
        if (tier.name !== undefined) {
          updateExpression.push('#name = :name');
          expressionAttributeNames['#name'] = 'name';
          expressionAttributeValues[':name'] = tier.name;
        }
        if (tier.basePrice !== undefined) {
          updateExpression.push('basePrice = :basePrice');
          expressionAttributeValues[':basePrice'] = tier.basePrice;
        }
        if (tier.baseCredits !== undefined) {
          updateExpression.push('baseCredits = :baseCredits');
          expressionAttributeValues[':baseCredits'] = tier.baseCredits;
        }
        if (tier.bonusCredits !== undefined) {
          updateExpression.push('bonusCredits = :bonusCredits');
          expressionAttributeValues[':bonusCredits'] = tier.bonusCredits;
        }
        if (tier.isActive !== undefined) {
          updateExpression.push('isActive = :isActive');
          expressionAttributeValues[':isActive'] = tier.isActive;
        }
        if (tier.isOnSale !== undefined) {
          updateExpression.push('isOnSale = :isOnSale');
          expressionAttributeValues[':isOnSale'] = tier.isOnSale;
        }
        if (tier.salePrice !== undefined) {
          updateExpression.push('salePrice = :salePrice');
          expressionAttributeValues[':salePrice'] = tier.salePrice;
        }
        if (tier.saleBonusCredits !== undefined) {
          updateExpression.push('saleBonusCredits = :saleBonusCredits');
          expressionAttributeValues[':saleBonusCredits'] = tier.saleBonusCredits;
        }
        if (tier.saleStartDate !== undefined) {
          updateExpression.push('saleStartDate = :saleStartDate');
          expressionAttributeValues[':saleStartDate'] = tier.saleStartDate;
        }
        if (tier.saleEndDate !== undefined) {
          updateExpression.push('saleEndDate = :saleEndDate');
          expressionAttributeValues[':saleEndDate'] = tier.saleEndDate;
        }
        if (tier.description !== undefined) {
          updateExpression.push('#description = :description');
          expressionAttributeNames['#description'] = 'description';
          expressionAttributeValues[':description'] = tier.description;
        }
        if (tier.displayOrder !== undefined) {
          updateExpression.push('displayOrder = :displayOrder');
          expressionAttributeValues[':displayOrder'] = tier.displayOrder;
        }

        updateExpression.push('updatedAt = :updatedAt');
        expressionAttributeValues[':updatedAt'] = now;

        await docClient.send(
          new UpdateCommand({
            TableName: CREDIT_TIER_TABLE,
            Key: { id: tierId },
            UpdateExpression: `SET ${updateExpression.join(', ')}`,
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
            ExpressionAttributeValues: expressionAttributeValues,
          })
        );

        // Fetch updated item
        const updatedResult = await docClient.send(
          new GetCommand({
            TableName: CREDIT_TIER_TABLE,
            Key: { id: tierId },
          })
        );

        // Create audit log entry
        await docClient.send(
          new PutCommand({
            TableName: ADMIN_AUDIT_TABLE,
            Item: {
              id: randomUUID(),
              action: 'UPDATE_CREDIT_TIER',
              adminUserId: identity.username,
              reason: tier.description !== undefined ? tier.description : (updatedResult.Item?.description || null),
              timestamp: now,
              metadata: {
                tierId: tierId,
                updatedFields: Object.keys(tier),
                tierData: tier,
              },
            },
          })
        );

        return JSON.stringify({
          success: true,
          data: updatedResult.Item,
        });
      }

      case 'delete': {
        if (!tierId) {
          throw new Error("Missing required argument: tierId");
        }

        // Get tier info before deleting for audit log
        const tierToDelete = await docClient.send(
          new GetCommand({
            TableName: CREDIT_TIER_TABLE,
            Key: { id: tierId },
          })
        );

        await docClient.send(
          new DeleteCommand({
            TableName: CREDIT_TIER_TABLE,
            Key: { id: tierId },
          })
        );

        // Create audit log entry
        await docClient.send(
          new PutCommand({
            TableName: ADMIN_AUDIT_TABLE,
            Item: {
              id: randomUUID(),
              action: 'DELETE_CREDIT_TIER',
              adminUserId: identity.username,
              timestamp: now,
              metadata: {
                tierId: tierId,
                deletedTier: tierToDelete.Item ? {
                  tierId: tierToDelete.Item.tierId,
                  name: tierToDelete.Item.name,
                  basePrice: tierToDelete.Item.basePrice,
                } : null,
              },
            },
          })
        );

        return JSON.stringify({
          success: true,
          message: `Tier ${tierId} deleted successfully`,
        });
      }

      default:
        throw new Error(`Invalid action: ${action}. Must be 'create', 'update', or 'delete'`);
    }
  } catch (error) {
    console.error("Error managing credit tier:", error);
    throw new Error(`Failed to manage credit tier: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

