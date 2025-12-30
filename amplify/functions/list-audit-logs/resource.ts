import { defineFunction } from '@aws-amplify/backend';

export const listAuditLogs = defineFunction({
  name: 'list-audit-logs',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

