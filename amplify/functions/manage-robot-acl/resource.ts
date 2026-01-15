import { defineFunction } from "@aws-amplify/backend";

export const manageRobotACL = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});

