import { defineFunction } from '@aws-amplify/backend';

export const getSystemStats = defineFunction({
  runtime: 22,
  name: 'get-system-stats',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

