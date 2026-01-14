import { defineFunction } from "@aws-amplify/backend";

export const createRatingResponse = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

