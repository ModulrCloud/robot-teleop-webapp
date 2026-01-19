import { defineFunction } from "@aws-amplify/backend";

export const setRobotLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
