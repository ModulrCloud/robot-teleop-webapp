import { defineFunction } from '@aws-amplify/backend';

export const cleanupAuditLogs = defineFunction({
  runtime: 22,
  name: 'cleanup-audit-logs',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

