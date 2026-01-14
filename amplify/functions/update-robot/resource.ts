import { defineFunction } from "@aws-amplify/backend";

export const updateRobotLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});

