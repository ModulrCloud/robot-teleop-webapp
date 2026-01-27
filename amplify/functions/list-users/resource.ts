import { defineFunction } from '@aws-amplify/backend';

export const listUsers = defineFunction({
  runtime: 22,
  name: 'list-users',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

