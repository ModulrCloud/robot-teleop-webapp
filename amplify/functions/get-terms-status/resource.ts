import { defineFunction } from "@aws-amplify/backend";

export const getTermsStatus = defineFunction({
  runtime: 22,
  name: "get-terms-status",
  entry: "./handler.ts",
  resourceGroupName: "data",
});
