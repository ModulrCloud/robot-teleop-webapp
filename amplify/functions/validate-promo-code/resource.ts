import { defineFunction } from '@aws-amplify/backend';

export const validatePromoCode = defineFunction({
  name: 'validate-promo-code',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'data',
});
