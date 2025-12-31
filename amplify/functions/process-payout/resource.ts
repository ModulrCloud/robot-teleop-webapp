import { defineFunction } from '@aws-amplify/backend';

export const processPayout = defineFunction({
  name: 'process-payout',
  entry: './handler.ts',
  resourceGroupName: 'data',
});


