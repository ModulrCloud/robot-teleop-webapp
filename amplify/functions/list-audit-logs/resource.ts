import { defineFunction } from '@aws-amplify/backend';

export const listAuditLogs = defineFunction({
  runtime: 22,
  name: 'list-audit-logs',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

