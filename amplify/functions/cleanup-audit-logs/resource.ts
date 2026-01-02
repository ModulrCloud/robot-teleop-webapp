import { defineFunction } from '@aws-amplify/backend';

export const cleanupAuditLogs = defineFunction({
  name: 'cleanup-audit-logs',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

