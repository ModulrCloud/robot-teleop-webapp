import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WHATS_NEW_TABLE = process.env.WHATS_NEW_TABLE!;

export interface WhatsNewListItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  publishedAt?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export const handler: Schema["listWhatsNewLambda"]["functionHandler"] = async () => {
  const result = await docClient.send(
    new ScanCommand({
      TableName: WHATS_NEW_TABLE,
    })
  );
  const items = (result.Items ?? []) as WhatsNewListItem[];
  // Sort by explicit sortOrder first (higher = first), then by date so manual reorder and tie-breaks work
  items.sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
    if (orderB !== orderA) return orderB - orderA;
    const dateA = a.publishedAt ?? a.createdAt ?? "";
    const dateB = b.publishedAt ?? b.createdAt ?? "";
    const byDate = dateB.localeCompare(dateA);
    if (byDate !== 0) return byDate;
    const createdA = a.createdAt ?? a.updatedAt ?? "";
    const createdB = b.createdAt ?? b.updatedAt ?? "";
    return createdB.localeCompare(createdA);
  });
  return JSON.stringify({ success: true, items });
};
