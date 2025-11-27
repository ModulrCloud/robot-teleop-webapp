/**
 * Migration Script: Fix Robot Timestamps
 * 
 * This script fixes robots in DynamoDB that have missing or incorrect timestamp formats.
 * It updates createdAt/updatedAt to use full ISO 8601 timestamps (AWSDateTime format).
 * 
 * Usage:
 *   npm run fix-robots [table-name]
 * 
 * Examples:
 *   # Auto-detect (requires ROBOT_TABLE_NAME env var)
 *   npm run fix-robots
 * 
 *   # Provide table name directly
 *   npm run fix-robots Robot-ow5aehmyrvglhnyauzh6dckela-NONE
 * 
 * To find your table name:
 *   1. Check CloudWatch logs for "tableName: 'Robot-...'"
 *   2. Or AWS Console → DynamoDB → Tables (look for "Robot-")
 * 
 * This script uses AWS credentials from your environment/profile.
 * Make sure you have AWS credentials configured:
 *   - Run: aws configure
 *   - Or set: AWS_PROFILE=your-profile-name
 *   - Or set: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

// Use AWS credentials from environment/profile
// This script doesn't need Amplify auth since we're accessing DynamoDB directly
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1', // Default to us-east-1 based on your setup
});

async function fixRobotTimestamps() {
  console.log('🔧 Starting robot timestamp migration...\n');

  try {
    // Note: This script runs in Node.js, so it can't access browser localStorage
    // We'll use AWS credentials directly from the environment/credentials file
    // The DynamoDB client will use your AWS credentials automatically
    console.log('ℹ️  Using AWS credentials from your environment/profile...');
    console.log('   Make sure you have AWS credentials configured (aws configure or AWS_PROFILE)\n');

    // Get the robot table name from command line argument or environment variable
    // From CloudWatch logs, we can see the table name format: Robot-ow5aehmyrvglhnyauzh6dckela-NONE
    const robotTableName = process.argv[2] || process.env.ROBOT_TABLE_NAME;
    
    if (!robotTableName) {
      console.error('❌ Robot table name is required.');
      console.log('\n💡 Usage: npm run fix-robots [table-name]');
      console.log('💡 Or set: export ROBOT_TABLE_NAME="Robot-xxxxx-NONE"');
      console.log('\n📋 To find your table name:');
      console.log('   1. Check CloudWatch logs: Look for "tableName: \'Robot-...\'"');
      console.log('   2. AWS Console → DynamoDB → Tables (look for table starting with "Robot-")');
      console.log('   3. From your CloudWatch log, the table name is: Robot-ow5aehmyrvglhnyauzh6dckela-NONE');
      return;
    }

    console.log(`📋 Scanning table: ${robotTableName}\n`);

    // Scan all robots from DynamoDB
    const scanResult = await ddbClient.send(new ScanCommand({
      TableName: robotTableName,
    }));

    if (!scanResult.Items || scanResult.Items.length === 0) {
      console.log('ℹ️  No robots found in the database.');
      return;
    }

    console.log(`📊 Found ${scanResult.Items.length} robot(s) in database\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    const now = new Date().toISOString();

    for (const item of scanResult.Items) {
      const robotId = item.id?.S;
      const robotName = item.name?.S || 'Unknown';
      const createdAt = item.createdAt?.S;
      const updatedAt = item.updatedAt?.S;

      // Check if timestamps need fixing
      const needsFix = 
        !createdAt || 
        !updatedAt || 
        !createdAt.includes('T') || // Date-only format (YYYY-MM-DD)
        !updatedAt.includes('T');     // Date-only format (YYYY-MM-DD)

      if (!needsFix) {
        console.log(`✅ ${robotName} (${robotId}) - Already has correct timestamps`);
        skippedCount++;
        continue;
      }

      console.log(`🔧 Fixing ${robotName} (${robotId})...`);
      console.log(`   Old createdAt: ${createdAt || 'MISSING'}`);
      console.log(`   Old updatedAt: ${updatedAt || 'MISSING'}`);

      // Update the robot with correct timestamps
      // If createdAt is missing, use current time. Otherwise, try to preserve the original date
      let newCreatedAt = now;
      let newUpdatedAt = now;

      if (createdAt && createdAt.includes('-')) {
        // If we have a date, convert it to full ISO timestamp
        // Try to preserve the original date but add a default time
        try {
          const dateOnly = createdAt.split('T')[0]; // Handle both formats
          newCreatedAt = `${dateOnly}T00:00:00.000Z`;
        } catch {
          newCreatedAt = now;
        }
      }

      if (updatedAt && updatedAt.includes('-')) {
        try {
          const dateOnly = updatedAt.split('T')[0];
          newUpdatedAt = `${dateOnly}T00:00:00.000Z`;
        } catch {
          newUpdatedAt = now;
        }
      }

      await ddbClient.send(new UpdateItemCommand({
        TableName: robotTableName,
        Key: { id: { S: robotId! } },
        UpdateExpression: 'SET createdAt = :createdAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':createdAt': { S: newCreatedAt },
          ':updatedAt': { S: newUpdatedAt },
        },
      }));

      console.log(`   ✅ Updated to createdAt: ${newCreatedAt}`);
      console.log(`   ✅ Updated to updatedAt: ${newUpdatedAt}\n`);
      fixedCount++;
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Fixed: ${fixedCount} robot(s)`);
    console.log(`   ⏭️  Skipped: ${skippedCount} robot(s) (already correct)`);
    console.log(`   📦 Total: ${scanResult.Items.length} robot(s)\n`);

    if (fixedCount > 0) {
      console.log('✅ Migration completed! Refresh the "Select Robot" page to see all robots.');
    } else {
      console.log('ℹ️  No robots needed fixing.');
    }

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    if (error.recoverySuggestion) {
      console.error('Recovery Suggestion:', error.recoverySuggestion);
    }
  }
}

fixRobotTimestamps();

