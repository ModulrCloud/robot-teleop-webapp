import { defineFunction } from "@aws-amplify/backend";

export const assignAdmin = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

