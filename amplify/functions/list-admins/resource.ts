import { defineFunction } from "@aws-amplify/backend";

export const listAdmins = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

