import { defineFunction } from '@aws-amplify/backend';

export const getSystemStats = defineFunction({
  name: 'get-system-stats',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

