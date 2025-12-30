import { defineFunction } from '@aws-amplify/backend';

export const listUsers = defineFunction({
  name: 'list-users',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

