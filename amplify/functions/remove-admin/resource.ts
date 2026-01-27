import { defineFunction } from "@aws-amplify/backend";

export const removeAdmin = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

