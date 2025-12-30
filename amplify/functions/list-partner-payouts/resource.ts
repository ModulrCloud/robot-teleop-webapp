import { defineFunction } from '@aws-amplify/backend';

export const listPartnerPayouts = defineFunction({
  name: 'list-partner-payouts',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

