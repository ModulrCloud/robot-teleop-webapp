import { defineFunction } from "@aws-amplify/backend";

export const listSessionsByRobot = defineFunction({
  runtime: 22,
  name: "list-sessions-by-robot",
  entry: "./handler.ts",
  resourceGroupName: "data",
});
