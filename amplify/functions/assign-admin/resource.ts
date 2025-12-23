import { defineFunction } from "@aws-amplify/backend";

export const assignAdmin = defineFunction({
  resourceGroupName: "data", // Assign to data stack
});

