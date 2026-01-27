import { defineFunction } from "@aws-amplify/backend";

export const deletePostLike = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});
