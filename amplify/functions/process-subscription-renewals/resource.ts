import { defineFunction } from '@aws-amplify/backend';

export const processSubscriptionRenewals = defineFunction({
  name: 'process-subscription-renewals',
  entry: './handler.ts',
  timeoutSeconds: 300, // 5 minutes - may need to process many subscriptions
  memoryMB: 512,
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
