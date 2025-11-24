import { defineFunction } from "@aws-amplify/backend";

export const manageRobotACL = defineFunction({
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});

