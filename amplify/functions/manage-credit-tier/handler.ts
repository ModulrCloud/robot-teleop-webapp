import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';
import { createAuditLog } from '../shared/audit-log';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const CREDIT_TIER_TABLE = process.env.CREDIT_TIER_TABLE!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["manageCreditTierLambda"]["functionHandler"] = async (event) => {
  console.log("=== MANAGE_CREDIT_TIER LAMBDA START ===");
  console.log("Full event:", JSON.stringify(event, null, 2));
  console.log("Action:", event.arguments?.action);
  console.log("TierId:", event.arguments?.tierId);
  console.log("Has tierData:", !!event.arguments?.tierData);
  
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
    console.log(`[MANAGE_CREDIT_TIER] Entering try block, action: ${action}`);
    const now = new Date().toISOString();
    console.log(`[MANAGE_CREDIT_TIER] Current timestamp: ${now}`);

    switch (action) {
      case 'create': {
        console.log(`[MANAGE_CREDIT_TIER] 📝 CREATE action selected`);
        if (!tierData) {
          console.error(`[MANAGE_CREDIT_TIER] ❌ Missing tierData`);
          throw new Error("Missing required argument: tierData");
        }
        console.log(`[MANAGE_CREDIT_TIER] tierData received:`, JSON.stringify(tierData, null, 2));

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

        console.log(`[MANAGE_CREDIT_TIER] ✅ Tier created successfully. Now creating audit log...`);
        console.log(`[MANAGE_CREDIT_TIER] About to call createAuditLog function...`);
        
        const auditLogParams = {
          action: 'CREATE_CREDIT_TIER',
          adminUserId: identity.username,
          reason: item.description || undefined,
          metadata: {
            tierId: item.tierId,
            tierName: item.name,
            basePrice: item.basePrice,
            baseCredits: item.baseCredits,
            bonusCredits: item.bonusCredits,
          },
        };
        console.log(`[MANAGE_CREDIT_TIER] Audit log params:`, JSON.stringify(auditLogParams, null, 2));

        // Track audit log creation for debug info
        let auditLogCreated = false;
        let auditLogError: string | null = null;
        
        // Create audit log entry - await it to get actual result
        console.log(`[MANAGE_CREDIT_TIER] ⏳ CALLING createAuditLog NOW...`);
        try {
          await createAuditLog(docClient, auditLogParams);
          auditLogCreated = true;
          console.log(`[MANAGE_CREDIT_TIER] ✅✅✅ createAuditLog completed successfully`);
        } catch (auditError) {
          auditLogCreated = false;
          auditLogError = auditError instanceof Error ? auditError.message : String(auditError);
          console.error(`[MANAGE_CREDIT_TIER] ❌❌❌ createAuditLog FAILED:`, auditError);
          // Don't re-throw - audit logging failures shouldn't break the main operation
        }
        console.log(`[MANAGE_CREDIT_TIER] ⏭️ Continuing after audit log call...`);

        const response = JSON.stringify({
          success: true,
          data: item,
          debug: {
            auditLogCalled: true,
            auditLogCreated: auditLogCreated,
            auditLogError: auditLogError,
            timestamp: new Date().toISOString(),
          },
        });
        console.log(`[MANAGE_CREDIT_TIER] Returning CREATE response:`, response);
        return response;
      }

      case 'update': {
        console.log(`[MANAGE_CREDIT_TIER] ✏️ UPDATE action selected`);
        console.log(`[MANAGE_CREDIT_TIER] tierId: ${tierId}, has tierData: ${!!tierData}`);
        if (!tierId || !tierData) {
          console.error(`[MANAGE_CREDIT_TIER] ❌ Missing required arguments`);
          throw new Error("Missing required arguments: tierId and tierData");
        }
        console.log(`[MANAGE_CREDIT_TIER] tierData received:`, JSON.stringify(tierData, null, 2));

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

        // IMPORTANT: Create audit log BEFORE returning success
        // This ensures the audit log is created even if there's an early return
        console.log(`[MANAGE_CREDIT_TIER] ✅ Tier updated successfully. Now creating audit log...`);
        console.log(`[MANAGE_CREDIT_TIER] About to call createAuditLog function...`);
        console.log(`[MANAGE_CREDIT_TIER] docClient type:`, typeof docClient);
        console.log(`[MANAGE_CREDIT_TIER] docClient exists:`, !!docClient);
        console.log(`[MANAGE_CREDIT_TIER] identity.username:`, identity.username);
        console.log(`[MANAGE_CREDIT_TIER] updatedResult.Item:`, JSON.stringify(updatedResult.Item, null, 2));
        
        const auditLogParams = {
          action: 'UPDATE_CREDIT_TIER',
          adminUserId: identity.username,
          reason: tier.description !== undefined ? tier.description : (updatedResult.Item?.description || undefined),
          metadata: {
            tierId: tierId,
            tierName: updatedResult.Item?.name || tier.name || 'Unknown',
            updatedFields: Object.keys(tier),
            tierData: tier,
          },
        };
        console.log(`[MANAGE_CREDIT_TIER] Audit log params:`, JSON.stringify(auditLogParams, null, 2));

        // Track audit log creation for debug info
        let auditLogCreated = false;
        let auditLogError: string | null = null;
        
        // Create audit log entry - await it to get actual result
        console.log(`[MANAGE_CREDIT_TIER] ⏳ CALLING createAuditLog NOW...`);
        try {
          await createAuditLog(docClient, auditLogParams);
          auditLogCreated = true;
          console.log(`[MANAGE_CREDIT_TIER] ✅✅✅ createAuditLog completed successfully`);
        } catch (auditError) {
          auditLogCreated = false;
          auditLogError = auditError instanceof Error ? auditError.message : String(auditError);
          console.error(`[MANAGE_CREDIT_TIER] ❌❌❌ createAuditLog FAILED with error:`, auditError);
          console.error(`[MANAGE_CREDIT_TIER] Error type:`, auditError instanceof Error ? auditError.constructor.name : typeof auditError);
          console.error(`[MANAGE_CREDIT_TIER] Error message:`, auditError instanceof Error ? auditError.message : String(auditError));
          console.error(`[MANAGE_CREDIT_TIER] Error stack:`, auditError instanceof Error ? auditError.stack : 'No stack trace');
          console.error(`[MANAGE_CREDIT_TIER] Full error:`, JSON.stringify(auditError, Object.getOwnPropertyNames(auditError), 2));
          // Don't re-throw - audit logging failures shouldn't break the main operation
        }
        
        console.log(`[MANAGE_CREDIT_TIER] ⏭️ Continuing after audit log call...`);

        const response = JSON.stringify({
          success: true,
          data: updatedResult.Item,
          debug: {
            auditLogCalled: true,
            auditLogCreated: auditLogCreated,
            auditLogError: auditLogError,
            timestamp: new Date().toISOString(),
          },
        });
        console.log(`[MANAGE_CREDIT_TIER] Returning UPDATE response:`, response);
        return response;
      }

      case 'delete': {
        console.log(`[MANAGE_CREDIT_TIER] 🗑️ DELETE action selected`);
        console.log(`[MANAGE_CREDIT_TIER] tierId: ${tierId}`);
        if (!tierId) {
          console.error(`[MANAGE_CREDIT_TIER] ❌ Missing tierId`);
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

        console.log(`[MANAGE_CREDIT_TIER] ✅ Tier deleted successfully. Now creating audit log...`);
        console.log(`[MANAGE_CREDIT_TIER] About to call createAuditLog function...`);
        
        const auditLogParams = {
          action: 'DELETE_CREDIT_TIER',
          adminUserId: identity.username,
          reason: tierToDelete.Item?.description || undefined,
          metadata: {
            tierId: tierId,
            deletedTier: tierToDelete.Item ? {
              tierId: tierToDelete.Item.tierId,
              name: tierToDelete.Item.name,
              basePrice: tierToDelete.Item.basePrice,
            } : null,
          },
        };
        console.log(`[MANAGE_CREDIT_TIER] Audit log params:`, JSON.stringify(auditLogParams, null, 2));

        // Track audit log creation for debug info
        let auditLogCreated = false;
        let auditLogError: string | null = null;
        
        // Create audit log entry - await it to get actual result
        console.log(`[MANAGE_CREDIT_TIER] ⏳ CALLING createAuditLog NOW...`);
        try {
          await createAuditLog(docClient, auditLogParams);
          auditLogCreated = true;
          console.log(`[MANAGE_CREDIT_TIER] ✅✅✅ createAuditLog completed successfully`);
        } catch (auditError) {
          auditLogCreated = false;
          auditLogError = auditError instanceof Error ? auditError.message : String(auditError);
          console.error(`[MANAGE_CREDIT_TIER] ❌❌❌ createAuditLog FAILED:`, auditError);
          // Don't re-throw - audit logging failures shouldn't break the main operation
        }
        console.log(`[MANAGE_CREDIT_TIER] ⏭️ Continuing after audit log call...`);

        const response = JSON.stringify({
          success: true,
          message: `Tier ${tierId} deleted successfully`,
          debug: {
            auditLogCalled: true,
            auditLogCreated: auditLogCreated,
            auditLogError: auditLogError,
            timestamp: new Date().toISOString(),
          },
        });
        console.log(`[MANAGE_CREDIT_TIER] Returning DELETE response:`, response);
        return response;
      }

      default:
        console.error(`[MANAGE_CREDIT_TIER] ❌ Invalid action: ${action}`);
        throw new Error(`Invalid action: ${action}. Must be 'create', 'update', or 'delete'`);
    }
    
    console.log(`[MANAGE_CREDIT_TIER] ✅ Switch statement completed successfully`);
    console.log(`=== MANAGE_CREDIT_TIER LAMBDA END (SUCCESS) ===`);
  } catch (error) {
    console.error("=== MANAGE_CREDIT_TIER LAMBDA END (ERROR) ===");
    console.error("Error managing credit tier:", error);
    console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    throw new Error(`Failed to manage credit tier: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

