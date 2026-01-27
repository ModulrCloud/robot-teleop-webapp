import { defineFunction } from '@aws-amplify/backend';

export const purchaseUsername = defineFunction({
  name: 'purchase-username',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
