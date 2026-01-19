import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import outputs from '../amplify_outputs.json';

const region = (outputs as any).auth?.aws_region || 'eu-west-2';
const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TIERS = [
  { tierId: '20', name: 'Starter Pack', basePrice: 20, baseCredits: 2000, bonusCredits: 0, displayOrder: 1 },
  { tierId: '50', name: 'Pro Pack', basePrice: 50, baseCredits: 5000, bonusCredits: 500, displayOrder: 2 },
  { tierId: '100', name: 'Elite Pack', basePrice: 100, baseCredits: 10000, bonusCredits: 1500, displayOrder: 3 },
];

async function findTable(): Promise<string> {
  const result = await dynamoClient.send(new ListTablesCommand({}));
  const table = result.TableNames?.find(n => n.startsWith('CreditTier-') && n.endsWith('-NONE'));
  if (!table) throw new Error('CreditTier table not found. Is sandbox running?');
  return table;
}

async function seed() {
  const table = await findTable();
  console.log(`Seeding ${table} (${region})\n`);

  const existing = await docClient.send(new ScanCommand({ TableName: table, Limit: 10 }));
  if (existing.Items?.length) {
    console.log(`Table has ${existing.Items.length} tier(s). Overwriting...\n`);
  }

  const now = new Date().toISOString();
  for (const tier of TIERS) {
    await docClient.send(new PutCommand({
      TableName: table,
      Item: { id: `tier-${tier.tierId}`, ...tier, isActive: true, createdAt: now, updatedAt: now },
    }));
    console.log(`✓ ${tier.name} ($${tier.basePrice})`);
  }

  console.log('\nDone.');
}

seed().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
