import { defineFunction } from '@aws-amplify/backend';

export const listPartnerPayouts = defineFunction({
  runtime: 22,
  name: 'list-partner-payouts',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

