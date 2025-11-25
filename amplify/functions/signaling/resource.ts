import { defineFunction } from "@aws-amplify/backend";

// May need to adjust time and memory
export const signaling = defineFunction({
  name: 'signaling',
  entry: './amplify/functions/signaling/handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});