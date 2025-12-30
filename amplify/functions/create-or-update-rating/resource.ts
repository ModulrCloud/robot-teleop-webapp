import { defineFunction } from "@aws-amplify/backend";

export const createOrUpdateRating = defineFunction({
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

