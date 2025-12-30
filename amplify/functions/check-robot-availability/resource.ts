import { defineFunction } from "@aws-amplify/backend";

export const checkRobotAvailability = defineFunction({
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

