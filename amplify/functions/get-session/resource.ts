import { defineFunction } from "@aws-amplify/backend";

export const getSessionLambda = defineFunction({
  runtime: 22,
  name: "get-session",
  entry: "./handler.ts",
  resourceGroupName: "data",
});

