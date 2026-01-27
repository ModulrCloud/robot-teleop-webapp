import { defineFunction } from '@aws-amplify/backend';

export const processRobotReservationRefunds = defineFunction({
  runtime: 22,
  name: 'process-robot-reservation-refunds',
  entry: './handler.ts',
  resourceGroupName: "data",
});

