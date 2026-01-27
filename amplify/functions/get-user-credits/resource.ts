import { defineFunction } from "@aws-amplify/backend";

export const getUserCredits = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

