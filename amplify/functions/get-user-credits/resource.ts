import { defineFunction } from "@aws-amplify/backend";

export const getUserCredits = defineFunction({
  resourceGroupName: "data", // Assign to data stack
});

