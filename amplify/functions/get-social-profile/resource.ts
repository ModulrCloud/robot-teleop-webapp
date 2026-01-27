import { defineFunction } from '@aws-amplify/backend';

export const getSocialProfile = defineFunction({
  name: 'get-social-profile',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
