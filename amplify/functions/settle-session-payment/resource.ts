import { defineFunction } from '@aws-amplify/backend';

export const settleSessionPayment = defineFunction({
  runtime: 22,
  name: 'settle-session-payment',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
