/**
 * Type definitions for Admin panel components
 * These types replace 'any' usage throughout the Admin components
 */

// User Management Types
export interface User {
  username: string;
  email?: string;
  name?: string;
  classification?: 'CLIENT' | 'PARTNER' | 'ADMIN';
  credits?: number;
  enabled?: boolean;
  createdAt?: string;
}

export interface UserRobot {
  id: string;
  name?: string;
  model?: string;
  city?: string;
  state?: string;
  country?: string;
  partnerId?: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  type?: 'purchase' | 'adjustment' | 'deduction' | 'refund';
  amount?: number;
  pricePaid?: number;
  currency?: string;
  description?: string;
  createdAt?: string;
}

// Payout Management Types
export interface Payout {
  id: string;
  partnerId?: string;
  partnerEmail?: string;
  robotId?: string;
  robotName?: string;
  creditsEarnedDollars?: number;
  platformFeeDollars?: number;
  totalCreditsChargedDollars?: number;
  status?: 'pending' | 'paid' | 'cancelled';
  reservationId?: string;
  sessionId?: string;
  payoutDate?: string;
  createdAt?: string;
  durationSeconds?: number;
  durationMinutes?: number;
}

// Audit Log Types
export interface AuditLogMetadata {
  robotName?: string;
  robotModel?: string;
  oldBalance?: number;
  newBalance?: number;
  creditsAmount?: number;
  oldClassification?: string;
  newClassification?: string;
  tierId?: string;
  tierName?: string;
  deletedTier?: {
    tierId?: string;
    name?: string;
    basePrice?: number;
  };
  updatedFields?: string[];
  tierData?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional metadata fields
}

export interface AuditLog {
  id: string;
  action: string;
  adminUserId?: string;
  adminEmail?: string;
  targetUserId?: string;
  targetEmail?: string;
  reason?: string | null;
  timestamp?: string;
  metadata?: AuditLogMetadata;
}

// System Statistics Types
export interface SystemStats {
  totalUsers?: number;
  totalRobots?: number | null;
  totalRevenue?: number;
  totalCredits?: number;
  activeSessions?: number;
}

// Platform Settings Types
export interface CreditTier {
  id?: string;
  tierId: string;
  name: string;
  basePrice: number;
  baseCredits: number;
  bonusCredits?: number;
  isActive?: boolean;
  description?: string;
  displayOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Lambda Response Types
export interface LambdaResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
  body?: string | T;
}

export interface PaginatedResponse<T> {
  success?: boolean;
  data?: T[];
  items?: T[];
  nextToken?: string | null;
  paginationToken?: string | null;
}

// Specific Lambda Response Types
export interface UsersResponse extends PaginatedResponse<User> {
  users?: User[];
}

export interface PayoutsResponse extends PaginatedResponse<Payout> {
  payouts?: Payout[];
}

export interface AuditLogsResponse extends PaginatedResponse<AuditLog> {
  auditLogs?: AuditLog[];
}

export interface SystemStatsResponse {
  success?: boolean;
  stats?: SystemStats;
}

export interface CreditAdjustmentResponse {
  success?: boolean;
  newBalance?: number;
  error?: string;
  message?: string;
}

export interface CreditTierResponse {
  success?: boolean | string;
  data?: CreditTier;
  error?: string;
  message?: string;
  debug?: {
    auditLogCalled?: boolean;
    auditLogCreated?: boolean;
    auditLogError?: string | null;
    timestamp?: string;
  };
}

// GraphQL Error Type (compatible with Amplify's GraphQLFormattedError)
export type GraphQLError = {
  message?: string;
} & Record<string, unknown>;

