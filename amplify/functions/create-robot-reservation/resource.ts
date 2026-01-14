import { defineFunction } from "@aws-amplify/backend";

export const createRobotReservation = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

