import { defineFunction } from "@aws-amplify/backend";

export const registerRobotKey = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
