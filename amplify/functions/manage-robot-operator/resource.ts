import { defineFunction } from "@aws-amplify/backend";

export const manageRobotOperator = defineFunction({
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});

