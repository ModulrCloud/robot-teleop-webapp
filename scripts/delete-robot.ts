/**
 * Script to Delete Robots from DynamoDB
 * 
 * This script allows you to delete robot entries from DynamoDB.
 * 
 * Usage:
 *   npm run delete-robot [table-name] [robot-id]
 * 
 * Examples:
 *   # Delete a specific robot by ID
 *   npm run delete-robot Robot-ow5aehmyrvglhnyauzh6dckela-NONE f26c35d0-4872-4529-8287-95486766ba4c
 * 
 *   # List all robots first (to find IDs)
 *   npm run inspect-robots
 * 
 * To find your table name:
 *   1. Check CloudWatch logs for "tableName: 'Robot-...'"
 *   2. Or AWS Console → DynamoDB → Tables (look for "Robot-")
 * 
 * This script uses AWS credentials from your environment/profile.
 * Make sure you have AWS credentials configured:
 *   - Run: aws configure
 *   - Or set: AWS_PROFILE=your-profile-name
 */

import { DynamoDBClient, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

async function deleteRobot() {
  const robotTableName = process.argv[2];
  const robotId = process.argv[3];

  if (!robotTableName || !robotId) {
    console.error('❌ Missing required arguments.');
    console.log('\n💡 Usage: npm run delete-robot [table-name] [robot-id]');
    console.log('\n📋 Examples:');
    console.log('   npm run delete-robot Robot-ow5aehmyrvglhnyauzh6dckela-NONE f26c35d0-4872-4529-8287-95486766ba4c');
    console.log('\n💡 To find robot IDs, first run:');
    console.log('   npm run inspect-robots');
    console.log('\n💡 To find table name:');
    console.log('   1. Check CloudWatch logs for "tableName: \'Robot-...\'"');
    console.log('   2. Or AWS Console → DynamoDB → Tables');
    return;
  }

  try {
    console.log(`🗑️  Deleting robot ${robotId} from table ${robotTableName}...\n`);

    // First, verify the robot exists
    const scanResult = await ddbClient.send(new ScanCommand({
      TableName: robotTableName,
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: {
        ':id': { S: robotId },
      },
      Limit: 1,
    }));

    if (!scanResult.Items || scanResult.Items.length === 0) {
      console.error(`❌ Robot with ID ${robotId} not found in table ${robotTableName}`);
      return;
    }

    const robot = scanResult.Items[0];
    const robotName = robot.name?.S || 'Unknown';
    const robotDescription = robot.description?.S || '';

    console.log(`📋 Found robot:`);
    console.log(`   Name: ${robotName}`);
    console.log(`   Description: ${robotDescription}`);
    console.log(`   ID: ${robotId}\n`);

    // Delete the robot
    await ddbClient.send(new DeleteItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robotId } },
    }));

    console.log(`✅ Successfully deleted robot "${robotName}" (${robotId})`);
    console.log('\n💡 Refresh the "Select Robot" page to see the updated list.');

  } catch (error: any) {
    console.error('❌ Failed to delete robot:', error.message);
    if (error.name === 'ResourceNotFoundException') {
      console.error('   The table was not found. Check the table name.');
    } else if (error.name === 'AccessDeniedException') {
      console.error('   Access denied. Check your AWS credentials and permissions.');
    }
  }
}

deleteRobot();

