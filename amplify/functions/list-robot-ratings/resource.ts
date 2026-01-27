import { defineFunction } from "@aws-amplify/backend";

export const listRobotRatings = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

