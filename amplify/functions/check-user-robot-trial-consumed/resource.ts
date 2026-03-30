import { defineFunction } from '@aws-amplify/backend';

export const checkUserRobotTrialConsumed = defineFunction({
  runtime: 22,
  name: 'check-user-robot-trial-consumed',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
