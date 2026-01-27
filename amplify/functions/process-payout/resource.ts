import { defineFunction } from '@aws-amplify/backend';

export const processPayout = defineFunction({
  runtime: 22,
  name: 'process-payout',
  entry: './handler.ts',
  resourceGroupName: 'data',
});


