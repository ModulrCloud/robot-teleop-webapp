/**
 * Script to inspect robots in the database
 * This helps debug why robots aren't showing up
 * 
 * Usage: npm run inspect-robots
 */

import { generateClient } from 'aws-amplify/api';
import { Schema } from '../amplify/data/resource';
// Import amplify-config to ensure proper configuration
import '../src/amplify-config';

const client = generateClient<Schema>();

async function inspectRobots() {
  console.log('🔍 Inspecting robots in the database...\n');
  
  try {
    const response = await client.models.Robot.list();
    
    console.log('📊 Response Summary:');
    console.log(`  - Has data: ${!!response.data}`);
    console.log(`  - Data length: ${response.data?.length || 0}`);
    console.log(`  - Has errors: ${!!response.errors}`);
    console.log(`  - Errors length: ${response.errors?.length || 0}\n`);
    
    if (response.data && response.data.length > 0) {
      console.log('🤖 Robots found in database:');
      response.data.forEach((robot, index) => {
        console.log(`\n  Robot ${index + 1}:`);
        console.log(`    - ID: ${robot.id}`);
        console.log(`    - robotId: ${robot.robotId || '(missing)'}`);
        console.log(`    - Name: ${robot.name || '(missing)'}`);
        console.log(`    - Description: ${robot.description || '(missing)'}`);
        console.log(`    - Model: ${robot.model || '(missing)'}`);
        console.log(`    - Partner ID: ${robot.partnerId || '(missing)'}`);
        console.log(`    - createdAt: ${robot.createdAt || '(MISSING - THIS IS THE PROBLEM!)'}`);
        console.log(`    - updatedAt: ${robot.updatedAt || '(MISSING - THIS IS THE PROBLEM!)'}`);
      });
    } else {
      console.log('❌ No robots found in database');
    }
    
    if (response.errors && response.errors.length > 0) {
      console.log('\n❌ Errors:');
      response.errors.forEach((err: any, index: number) => {
        console.log(`\n  Error ${index + 1}:`);
        console.log(`    - Message: ${err.message}`);
        console.log(`    - Path: ${err.path?.join(' → ') || '(no path)'}`);
        console.log(`    - Full error:`, err);
      });
    }
    
    console.log('\n💡 If robots are missing createdAt/updatedAt, they were created before the fix.');
    console.log('   Solution: Recreate them or run a migration script to add the timestamps.');
    
  } catch (error) {
    console.error('❌ Failed to inspect robots:', error);
  }
}

inspectRobots().catch(console.error);

