import { defineFunction } from "@aws-amplify/backend";

export const getSessionLambda = defineFunction({
  name: "get-session",
  entry: "./handler.ts",
  resourceGroupName: "data",
});

