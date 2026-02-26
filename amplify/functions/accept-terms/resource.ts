import { defineFunction } from "@aws-amplify/backend";

export const acceptTerms = defineFunction({
  runtime: 22,
  name: "accept-terms",
  entry: "./handler.ts",
  resourceGroupName: "data",
});
