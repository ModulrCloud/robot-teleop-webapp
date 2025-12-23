import { defineFunction } from "@aws-amplify/backend";

export const listAdmins = defineFunction({
  resourceGroupName: "data", // Assign to data stack
});

