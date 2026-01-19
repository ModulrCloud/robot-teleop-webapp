import { defineFunction } from "@aws-amplify/backend";

export const setUserGroupLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});
