import { defineFunction } from "@aws-amplify/backend";

export const signaling = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency with user pool
});