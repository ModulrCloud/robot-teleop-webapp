import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { setUserGroupLambda } from "../functions/set-user-group/resource";
import { setRobotLambda } from "../functions/set-robot/resource";
import { updateRobotLambda } from "../functions/update-robot/resource";
import { revokeTokenLambda } from "../functions/revoke-token/resource";
import { manageRobotOperator } from "../functions/manage-robot-operator/resource";
import { deleteRobotLambda } from "../functions/delete-robot/resource";
import { manageRobotACL } from "../functions/manage-robot-acl/resource";
import { listAccessibleRobots } from "../functions/list-accessible-robots/resource";
import { getRobotStatus } from "../functions/get-robot-status/resource";
import { createStripeCheckout } from "../functions/create-stripe-checkout/resource";
import { addCredits } from "../functions/add-credits/resource";
import { verifyStripePayment } from "../functions/verify-stripe-payment/resource";
import { getUserCredits } from "../functions/get-user-credits/resource";
import { updateAutoTopUp } from "../functions/update-auto-topup/resource";
import { assignAdmin } from "../functions/assign-admin/resource";
import { removeAdmin } from "../functions/remove-admin/resource";
import { listAdmins } from "../functions/list-admins/resource";
import { listUsers } from "../functions/list-users/resource";
import { getSystemStats } from "../functions/get-system-stats/resource";
import { listAuditLogs } from "../functions/list-audit-logs/resource";
import { processSessionPayment } from "../functions/process-session-payment/resource";
import { deductSessionCredits } from "../functions/deduct-session-credits/resource";
import { createOrUpdateRating } from "../functions/create-or-update-rating/resource";
import { listRobotRatings } from "../functions/list-robot-ratings/resource";
import { createRatingResponse } from "../functions/create-rating-response/resource";
import { createRobotReservation } from "../functions/create-robot-reservation/resource";
import { listRobotReservations } from "../functions/list-robot-reservations/resource";
import { cancelRobotReservation } from "../functions/cancel-robot-reservation/resource";
import { checkRobotAvailability } from "../functions/check-robot-availability/resource";
import { manageRobotAvailability } from "../functions/manage-robot-availability/resource";
import { processRobotReservationRefunds } from "../functions/process-robot-reservation-refunds/resource";
import { listPartnerPayouts } from "../functions/list-partner-payouts/resource";
import { processPayout } from "../functions/process-payout/resource";
import { getSessionLambda } from "../functions/get-session/resource";
import { triggerConnectionCleanup } from "../functions/trigger-connection-cleanup/resource";
import { getActiveRobots } from "../functions/get-active-robots/resource";
import { manageCreditTier } from "../functions/manage-credit-tier/resource";

const LambdaResult = a.customType({
  statusCode: a.integer(),
  body: a.string(),
});

const RobotStatus = a.customType({
  isOnline: a.boolean(),
  lastSeen: a.integer(),
  status: a.string(),
});

const SessionResult = a.customType({
  id: a.string(),
  userId: a.string(),
  userEmail: a.string(),
  robotId: a.string(),
  robotName: a.string(),
  startedAt: a.string(),
  endedAt: a.string(),
  durationSeconds: a.integer(),
  status: a.string(),
});

const schema = a.schema({
  // Join table between partners and tags
  PartnerTag: a.model({
    partnerId: a.id().required(),
    tagId: a.id().required(),
    partner: a.belongsTo('Partner', 'partnerId'),
    tag: a.belongsTo('Tag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Join table between clients and tags
  ClientTag: a.model({
    clientId: a.id().required(),
    tagId: a.id().required(),
    client: a.belongsTo('Client', 'clientId'),
    tag: a.belongsTo('Tag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Descriptive tags for types of robots/services available
  Tag: a.model({
    name: a.string().required(),
    description: a.string(),
    partners: a.hasMany('PartnerTag', 'tagId'),
    clients: a.hasMany('ClientTag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Table containing partner details
  Partner: a.model({
    id: a.id(),
    cognitoUsername: a.string().authorization(allow => [allow.owner()]),
    name: a.string().required(), // Organization/company name
    displayName: a.string(), // Personal display name/alias for reviews (optional, defaults to organization name if not set)
    description: a.string().required(),
    publicKey: a.string(),
    averageRating: a.float(),
    reliabilityScore: a.float(),
    preferredCurrency: a.string(), // Partner's preferred currency (e.g., 'USD', 'EUR', 'GBP')
    tags: a.hasMany('PartnerTag', 'partnerId'),
    robots: a.hasMany('Robot', 'partnerId'),
    logoUrl: a.string(),
    websiteUrl: a.string(),
    contactEmail: a.string(),
    companyType: a.string(),
    integrationCode: a.string(),
    integrationDocsUrl: a.string(),
    isPublicProfile: a.boolean(),
    twitterUrl: a.string(),
    telegramUrl: a.string(),
    githubUrl: a.string(),
  })
  .secondaryIndexes(index => [index("cognitoUsername").name("cognitoUsernameIndex")])
  .authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Table containing client details
  Client: a.model({
    id: a.id(),
    cognitoUsername: a.string().authorization(allow => [allow.owner()]),
    displayName: a.string(), // Public display name/alias (optional, defaults to masked email if not set)
    publicKey: a.string(),
    averageRating: a.float(),
    reliabilityScore: a.float(),
    preferredCurrency: a.string(), // User's preferred currency (e.g., 'USD', 'EUR', 'GBP')
    tags: a.hasMany('ClientTag', 'clientId'),
  })
  .secondaryIndexes(index => [index("cognitoUsername").name("cognitoUsernameIndex")])
  .authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Master credits table - only Modulr (admins/Lambdas) can modify
  UserCredits: a.model({
    id: a.id(),
    userId: a.string().required(), // Cognito username - unique identifier
    userType: a.string(), // 'CLIENT' or 'PARTNER' (optional, for future filtering)
    credits: a.integer().default(0), // Current credit balance
    autoTopUpEnabled: a.boolean().default(false), // User preference
    autoTopUpThreshold: a.integer(), // Credits threshold (e.g., 100)
    autoTopUpTier: a.string(), // Which tier to auto-purchase ('20', '50', '100')
    stripeCustomerId: a.string(), // Stripe customer ID for saved payment methods
    stripePaymentMethodId: a.string(), // Saved payment method ID for auto top-up
    lastUpdated: a.datetime(), // When credits were last modified
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"), // For quick lookups
  ])
  .authorization((allow) => [
    // Authenticated users can read (filtering by userId happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create/update (Modulr control)
    allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
  ]),

  // Credit transaction history
  CreditTransaction: a.model({
    id: a.id(),
    userId: a.string().required(), // Cognito username
    amount: a.integer().required(), // Credits added (positive) or deducted (negative)
    pricePaid: a.float(), // Dollar amount paid (if purchase)
    currency: a.string(), // Currency code (e.g., 'USD', 'EUR')
    tier: a.string(), // Which tier was purchased ('20', '50', '100') or null if deduction
    stripePaymentIntentId: a.string(), // Stripe payment intent ID (for purchases)
    transactionType: a.string().required(), // 'purchase', 'deduction', 'refund', 'bonus'
    description: a.string(), // Human-readable description
    createdAt: a.datetime().required(),
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"), // For user transaction history
    index("createdAt").name("createdAtIndex"), // For sorting by date
  ])
  .authorization((allow) => [
    // Authenticated users can read (filtering by userId happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create (via Lambda after Stripe verification)
    allow.groups(['ADMINS']).to(['create', 'read']),
  ]),

  // Admin audit log - tracks all admin assignments/removals and credit adjustments
  AdminAudit: a.model({
    id: a.id(),
    action: a.string().required(), // 'ASSIGN_ADMIN', 'REMOVE_ADMIN', 'ADJUST_CREDITS', etc.
    adminUserId: a.string().required(), // Who performed the action
    targetUserId: a.string(), // Who was affected (optional for some actions)
    reason: a.string(), // Optional reason for the action
    timestamp: a.string().required(), // ISO timestamp
    metadata: a.json(), // Additional metadata (admin groups, counts, credits amount, old/new balance, etc.)
  })
  .secondaryIndexes(index => [
    index("adminUserId").name("adminUserIdIndex"), // Track actions by admin
    index("targetUserId").name("targetUserIdIndex"), // Track actions on user
    index("timestamp").name("timestampIndex"), // Sort by time
  ])
  .authorization((allow) => [
    // Only ADMINS can read and create audit logs (creates happen via assignAdmin/removeAdmin Lambdas)
    allow.groups(['ADMINS']).to(['create', 'read']),
  ]),

  // Dynamic credit tier configuration (supports sales/offers)
  CreditTier: a.model({
    id: a.id(),
    tierId: a.string().required(), // '20', '50', '100' - unique identifier
    name: a.string().required(), // Display name (e.g., "Starter Pack", "Pro Pack")
    basePrice: a.float().required(), // Base price in USD (e.g., 20.00)
    baseCredits: a.integer().required(), // Base credits (e.g., 1000)
    bonusCredits: a.integer().default(0), // Bonus credits (e.g., 100)
    isActive: a.boolean().default(true), // Whether tier is available for purchase
    isOnSale: a.boolean().default(false), // Whether tier is currently on sale
    salePrice: a.float(), // Sale price if on sale (e.g., 15.00)
    saleBonusCredits: a.integer(), // Extra bonus credits during sale
    saleStartDate: a.datetime(), // When sale starts
    saleEndDate: a.datetime(), // When sale ends
    description: a.string(), // Marketing description
    displayOrder: a.integer(), // Order to display tiers (1, 2, 3)
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  })
  .secondaryIndexes(index => [
    index("tierId").name("tierIdIndex"), // For quick tier lookups
  ])
  .authorization((allow) => [
    // Everyone can read tiers (for purchase UI - filtering by isActive happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create/update (Modulr control for sales/offers)
    allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
  ]),

  // Platform settings (markup percentage, etc.) - managed by ADMINS
  PlatformSettings: a.model({
    id: a.id(),
    settingKey: a.string().required(), // 'platformMarkupPercent', 'minimumPayoutAmount', etc.
    settingValue: a.string().required(), // JSON string or simple value
    description: a.string(), // What this setting controls
    updatedBy: a.string(), // Admin user who last updated
    updatedAt: a.datetime().required(),
  })
  .secondaryIndexes(index => [
    index("settingKey").name("settingKeyIndex"), // For quick lookups
  ])
  .authorization((allow) => [
    // Everyone can read (for calculating costs)
    allow.authenticated().to(['read']),
    // Only ADMINS can create/update
    allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
  ]),

  // Partner payout tracking - tracks earnings and payouts for robot partners
  PartnerPayout: a.model({
    id: a.id(),
    partnerId: a.string().required(), // Partner's Cognito user ID
    partnerEmail: a.string(), // Partner's email for display
    sessionId: a.string(), // Reference to the Session that generated this payout (optional)
    reservationId: a.string(), // Reference to the Reservation that generated this payout (optional)
    robotId: a.string().required(), // Robot that generated the earnings
    robotName: a.string(), // Robot name for display
    creditsEarned: a.float().required(), // Credits earned by partner (after markup)
    platformFee: a.float().required(), // Platform markup deducted
    totalCreditsCharged: a.float().required(), // Total credits charged to user
    durationSeconds: a.integer(), // Session duration (optional for reservations)
    durationMinutes: a.integer(), // Reservation duration in minutes (optional)
    status: a.string().required(), // 'pending', 'paid', 'cancelled'
    payoutDate: a.datetime(), // When payout was processed (if paid)
    createdAt: a.datetime().required(), // When payout was created
  })
  .secondaryIndexes(index => [
    index("partnerId").name("partnerIdIndex"), // For partner earnings view
    index("status").name("statusIndex"), // For filtering by payout status
    index("createdAt").name("createdAtIndex"), // For sorting by date
  ])
  .authorization((allow) => [
    // Partners can read their own payouts
    allow.owner().to(['read']),
    // ADMINS can read all and manage payouts
    allow.groups(['ADMINS']).to(['read', 'update', 'delete']),
  ]),

  Robot: a.model({
    id: a.id(),
    name: a.string().required(),
    description: a.string().required(),
    model: a.string(),
    robotId: a.string(),
    partnerId: a.id().required(),
    partner: a.belongsTo('Partner', 'partnerId'),
    allowedUsers: a.string().array(), // Optional: if null/empty, robot is open access. If set, only listed users can access.
    imageUrl: a.string(),
    // Pricing: Hourly rate in credits (before platform markup)
    hourlyRateCredits: a.float().default(100), // Default 100 credits/hour (editable by robot owner)
    // Location fields
    city: a.string(),
    state: a.string(),
    country: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    ratings: a.hasMany('RobotRating', 'robotUuid'), // Relationship to ratings
    reservations: a.hasMany('RobotReservation', 'robotUuid'), // Relationship to reservations
    availability: a.hasMany('RobotAvailability', 'robotUuid'), // Relationship to availability blocks
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"), // For lookups by robotId string (robot-XXXXXXXX)
  ])
  .authorization((allow) => [
    allow.owner().to(["update", "delete"]),
    allow.authenticated().to(["read"]),
  ]),

  // Delegation table: Partners can assign operators to their robots
  RobotOperator: a.model({
    id: a.id(),
    robotId: a.string().required(), // The robotId string (not Robot.id) - used for lookup
    operatorUserId: a.string().required(), // Cognito user ID (sub) of the delegated operator
    operatorUsername: a.string(), // Username for display purposes
    assignedBy: a.string().required(), // Cognito user ID who assigned this delegation
    assignedAt: a.string().required(), // ISO timestamp
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"),
    index("operatorUserId").name("operatorUserIdIndex"),
  ])
  .authorization((allow) => [
    allow.authenticated().to(["read"]),
    allow.owner(), // Only the partner who owns the robot can manage operators
  ]),

  // Session history for teleoperation sessions
  Session: a.model({
    id: a.id(),
    userId: a.string().required(),        // Cognito username of the user
    userEmail: a.string(),                // User's email for display
    robotId: a.string().required(),       // Robot's robotId (robot-XXXXXXXX)
    robotName: a.string(),                // Robot name for display
    partnerId: a.string(),                // Partner who owns the robot
    connectionId: a.string(),             // WebSocket connection ID (for cleanup on disconnect)
    startedAt: a.datetime().required(),   // When session started
    endedAt: a.datetime(),                // When session ended
    durationSeconds: a.integer(),         // Total duration in seconds
    status: a.string(),                   // 'active', 'completed', 'disconnected', 'insufficient_funds'
    // Cost tracking
    creditsCharged: a.float(),            // Total credits charged to user (includes markup) - final total when session ends
    creditsDeductedSoFar: a.float(),     // Cumulative credits deducted during active session (real-time billing)
    lastDeductionAt: a.datetime(),        // Timestamp of last per-minute deduction
    partnerEarnings: a.float(),           // Credits earned by partner (after markup)
    platformFee: a.float(),               // Platform markup in credits
    hourlyRateCredits: a.float(),        // Robot's hourly rate at time of session (snapshot)
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"),
    index("partnerId").name("partnerIdIndex"),
    index("robotId").name("robotIdIndex"),
    index("connectionId").name("connectionIdIndex") // GSI for fast lookup by connection ID (for cleanup on disconnect)
  ])
  .authorization((allow) => [
    allow.owner().to(['create', 'read', 'update']),
    allow.groups(['ADMINS']).to(['read', 'delete']),
  ]),

  // Robot ratings and reviews - one rating + one comment per user per robot
  RobotRating: a.model({
    id: a.id(),
    robotId: a.string().required(),        // Robot's robotId string (robot-XXXXXXXX) - for efficient lookup
    robotUuid: a.id().required(),         // Robot's UUID (id field) - for relationship to Robot
    robot: a.belongsTo('Robot', 'robotUuid'), // Relationship to Robot
    userId: a.string().required(),        // Cognito username of the reviewer (for moderation - only visible to admins)
    userEmail: a.string(),                // User's email (for moderation - only visible to modulr.cloud employees)
    userDisplayName: a.string().default("Anonymous"), // Public display name (defaults to "Anonymous" for privacy)
    rating: a.integer().required(),       // Rating: 1-5 (5 robots instead of stars)
    comment: a.string(),                  // Optional review comment (can be edited)
    sessionId: a.string(),                // Reference to the Session that qualified the user to rate
    sessionDurationSeconds: a.integer(),  // Duration of the qualifying session (must be >= 5 minutes, except modulr.cloud)
    isModulrEmployee: a.boolean().default(false), // True if reviewer is @modulr.cloud (bypasses session requirement)
    createdAt: a.datetime().required(),   // When rating was created
    updatedAt: a.datetime(),              // When rating/comment was last updated
    responses: a.hasMany('RobotRatingResponse', 'ratingId'), // Partner responses to this rating
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"), // For fetching all ratings for a robot (using robotId string)
    index("userId").name("userIdIndex"),   // For fetching all ratings by a user
    // Composite index for enforcing one rating per user per robot
    // Note: Amplify doesn't support composite unique constraints directly,
    // so we'll enforce this in the Lambda function
  ])
  .authorization((allow) => [
    allow.authenticated().to(['read']),    // Everyone can read ratings
    allow.owner().to(['create', 'update']), // Users can create/update their own ratings
    allow.groups(['ADMINS']).to(['read', 'delete']), // Admins can delete inappropriate ratings
  ]),

  // Partner responses to ratings
  RobotRatingResponse: a.model({
    id: a.id(),
    ratingId: a.id().required(),           // Reference to the RobotRating
    rating: a.belongsTo('RobotRating', 'ratingId'),
    partnerId: a.string().required(),      // Partner's Cognito username who is responding
    partnerEmail: a.string(),             // Partner's email (for internal use, not displayed publicly)
    partnerDisplayName: a.string(),        // Partner's public display name/alias (shown in responses)
    response: a.string().required(),      // Partner's response text
    createdAt: a.datetime().required(),   // When response was created
    updatedAt: a.datetime(),              // When response was last updated
  })
  .secondaryIndexes(index => [
    index("ratingId").name("ratingIdIndex"), // For fetching responses to a rating
    index("partnerId").name("partnerIdIndex"), // For fetching all responses by a partner
  ])
  .authorization((allow) => [
    allow.authenticated().to(['read']),    // Everyone can read responses
    allow.owner().to(['create', 'update']), // Partners can create/update their own responses
    allow.groups(['ADMINS']).to(['read', 'delete']), // Admins can delete inappropriate responses
  ]),

  // Robot availability - partners can block dates/times when robots are unavailable
  RobotAvailability: a.model({
    id: a.id(),
    robotId: a.string().required(),        // Robot's robotId string (robot-XXXXXXXX) - for efficient lookup
    robotUuid: a.id().required(),         // Robot's UUID (id field) - for relationship
    robot: a.belongsTo('Robot', 'robotUuid'), // Relationship to Robot
    partnerId: a.string().required(),     // Partner's Cognito username who owns the robot
    startTime: a.datetime().required(),   // When the availability block starts
    endTime: a.datetime().required(),     // When the availability block ends
    reason: a.string(),                    // Optional reason for the block (e.g., "Maintenance", "Private use")
    isRecurring: a.boolean().default(false), // If true, this is a recurring block (e.g., every Monday 9-5)
    recurrencePattern: a.string(),         // JSON string describing recurrence (e.g., {"type": "weekly", "days": [1], "endDate": "2024-12-31"})
    createdAt: a.datetime().required(),
    updatedAt: a.datetime(),
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"), // For fetching availability for a robot
    index("partnerId").name("partnerIdIndex"), // For fetching all availability blocks by a partner
    index("startTime").name("startTimeIndex"), // For querying by time range
  ])
  .authorization((allow) => [
    allow.authenticated().to(['read']),    // Everyone can read availability (to check if robot is available)
    allow.owner().to(['create', 'update', 'delete']), // Partners can manage their own robot availability
    allow.groups(['ADMINS']).to(['read', 'update', 'delete']), // Admins can manage all availability
  ]),

  // Robot reservations - users can book robots in advance
  RobotReservation: a.model({
    id: a.id(),
    robotId: a.string().required(),        // Robot's robotId string (robot-XXXXXXXX) - for efficient lookup
    robotUuid: a.id().required(),         // Robot's UUID (id field) - for relationship
    robot: a.belongsTo('Robot', 'robotUuid'), // Relationship to Robot
    userId: a.string().required(),        // Cognito username of the user making the reservation
    userEmail: a.string(),                 // User's email for display
    partnerId: a.string().required(),     // Partner's Cognito username who owns the robot
    startTime: a.datetime().required(),   // When the reservation starts
    endTime: a.datetime().required(),     // When the reservation ends
    durationMinutes: a.integer().required(), // Duration in minutes (minimum 15)
    status: a.string().required(),        // 'pending', 'confirmed', 'active', 'completed', 'cancelled', 'refunded'
    // Pricing
    depositCredits: a.float().required(),  // Deposit paid (at least 1 minute's cost)
    totalCostCredits: a.float().required(), // Total cost for the reservation (calculated at booking time)
    hourlyRateCredits: a.float().required(), // Robot's hourly rate at time of booking (snapshot)
    platformMarkupPercent: a.float().required(), // Platform markup at time of booking (snapshot)
    // Refund tracking
    refundedCredits: a.float().default(0), // Credits refunded if robot was offline during reservation
    refundReason: a.string(),              // Reason for refund (e.g., "Robot offline during reservation time")
    refundedAt: a.datetime(),               // When refund was processed
    // Session tracking
    sessionId: a.string(),                 // If reservation was converted to an active session
    // Notifications
    reminderSent: a.boolean().default(false), // Whether reminder notification was sent to partner
    reminderSentAt: a.datetime(),          // When reminder was sent
    createdAt: a.datetime().required(),
    updatedAt: a.datetime(),
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"), // For fetching reservations for a robot
    index("userId").name("userIdIndex"),   // For fetching user's reservations
    index("partnerId").name("partnerIdIndex"), // For fetching partner's robot reservations
    index("startTime").name("startTimeIndex"), // For querying by time range
    index("status").name("statusIndex"),   // For filtering by status
  ])
  .authorization((allow) => [
    allow.owner().to(['create', 'read', 'update']), // Users can create and view their own reservations
    allow.groups(['ADMINS']).to(['read', 'update', 'delete']), // Admins can manage all reservations
    // Partners can read reservations for their robots (for visibility)
    // This is handled via a Lambda function since we need to check robot ownership
  ]),

  setUserGroupLambda: a
    .mutation()
    .arguments({
      group: a.string(),
      targetUsername: a.string(), // Optional: if provided and caller is admin, change this user's group instead
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(setUserGroupLambda)),

  setRobotLambda: a
    .mutation()
    .arguments({
      robotName: a.string().required(),
      description: a.string(),
      model: a.string(),
      hourlyRateCredits: a.float(), // Optional: hourly rate in credits (defaults to 100)
      enableAccessControl: a.boolean(), // Optional: if true, creates ACL with default users
      additionalAllowedUsers: a.string().array(), // Optional: additional email addresses to add to ACL
      imageUrl: a.string(),
      // Location fields
      city: a.string(),
      state: a.string(),
      country: a.string(),
      latitude: a.float(),
      longitude: a.float(),
    })
    .returns(a.string())
    .authorization(allow => [allow.group('PARTNERS'), allow.group('ADMINS')])
    .handler(a.handler.function(setRobotLambda)),

  updateRobotLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to update
      robotName: a.string(), // Optional: update name
      description: a.string(), // Optional: update description
      model: a.string(), // Optional: update model
      hourlyRateCredits: a.float(), // Optional: update hourly rate in credits
      enableAccessControl: a.boolean(), // Optional: update ACL (true = enable/update, false = disable/remove)
      additionalAllowedUsers: a.string().array(), // Optional: additional email addresses to add to ACL (only used if enableAccessControl is true)
      imageUrl: a.string(), // Optional: update imageUrl
      // Location fields (optional)
      city: a.string(),
      state: a.string(),
      country: a.string(),
      latitude: a.float(),
      longitude: a.float(),
    })
    .returns(a.string())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(updateRobotLambda)),

  revokeTokenLambda: a
    .mutation()
    .arguments({
      token: a.string().required(),
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(revokeTokenLambda)),

  manageRobotOperatorLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(),
      operatorUserId: a.string().required(),
      operatorUsername: a.string(),
      action: a.string().required(), // 'add' or 'remove'
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(manageRobotOperator)),

  deleteRobotLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to delete
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(deleteRobotLambda)),

  manageRobotACLLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to manage ACL for
      userEmail: a.string(), // Email address to add/remove (required for 'add'/'remove' actions)
      action: a.string().required(), // 'add', 'remove', or 'delete' (delete removes entire ACL)
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(manageRobotACL)),

  listAccessibleRobotsLambda: a
    .query()
    .arguments({
      limit: a.integer(), // Optional: number of robots to return (default: 50)
      nextToken: a.string(), // Optional: pagination token from previous request
    })
    .returns(a.json()) // Return JSON object with robots array and nextToken
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (filters by ACL)
    .handler(a.handler.function(listAccessibleRobots)),

  getRobotStatusLambda: a
    .query()
    .arguments({
      robotId: a.string().required(),
    })
    .returns(RobotStatus)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (checks ACL)
    .handler(a.handler.function(getRobotStatus)),

  createStripeCheckoutLambda: a
    .mutation()
    .arguments({
      tierId: a.string().required(),
      userId: a.string().required(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(createStripeCheckout)),

  verifyStripePaymentLambda: a
    .mutation()
    .arguments({
      sessionId: a.string().required(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(verifyStripePayment)),

  processSessionPaymentLambda: a
    .mutation()
    .arguments({
      sessionId: a.string().required(), // Session ID to process payment for
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (checks session ownership)
    .handler(a.handler.function(processSessionPayment)),

  deductSessionCreditsLambda: a
    .mutation()
    .arguments({
      sessionId: a.string().required(), // Session ID to deduct credits for (per-minute)
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (checks session ownership)
    .handler(a.handler.function(deductSessionCredits)),

  addCreditsLambda: a
    .mutation()
    .arguments({
      userId: a.string().required(),
      credits: a.integer().required(), // Can be positive (add) or negative (deduct)
      amountPaid: a.float(),
      currency: a.string(),
      tierId: a.string(),
      description: a.string(), // Optional description for the credit adjustment
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization is handled in Lambda (checks owner/admin)
    .handler(a.handler.function(addCredits)),

  getUserCreditsLambda: a
    .query()
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization is handled in Lambda (returns own credits)
    .handler(a.handler.function(getUserCredits)),

  updateAutoTopUpLambda: a
    .mutation()
    .arguments({
      autoTopUpEnabled: a.boolean(),
      autoTopUpThreshold: a.integer(),
      autoTopUpTier: a.string(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization is handled in Lambda (updates own settings only)
    .handler(a.handler.function(updateAutoTopUp)),

  assignAdminLambda: a
    .mutation()
    .arguments({
      targetUserId: a.string().required(),
      reason: a.string(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(assignAdmin)),

  removeAdminLambda: a
    .mutation()
    .arguments({
      targetUserId: a.string().required(),
      reason: a.string(),
    })
    .returns(a.json())
    .authorization(allow => [allow.groups(['ADMINS'])]) // Only existing admins can remove admin
    .handler(a.handler.function(removeAdmin)),

  listAdminsLambda: a
    .query()
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(listAdmins)),

  manageCreditTierLambda: a
    .mutation()
    .arguments({
      action: a.string().required(), // 'create', 'update', or 'delete'
      tierId: a.string(), // Required for 'update' and 'delete'
      tierData: a.json(), // Required for 'create' and 'update'
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(manageCreditTier)),

  listUsersLambda: a
    .query()
    .arguments({
      limit: a.integer(),
      paginationToken: a.string(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(listUsers)),

  getSystemStatsLambda: a
    .query()
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(getSystemStats)),

  listAuditLogsLambda: a
    .query()
    .arguments({
      limit: a.integer(),
      paginationToken: a.string(),
      adminUserId: a.string(),
      targetUserId: a.string(),
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth check happens in Lambda (domain-based + group-based)
    .handler(a.handler.function(listAuditLogs)),

  createOrUpdateRatingLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(),
      rating: a.integer().required(), // 1-5 (5 robots instead of stars)
      comment: a.string(), // Optional review comment
      sessionId: a.string(), // Required for non-modulr.cloud users (validates 5-minute minimum)
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization handled in Lambda (validates session, enforces one rating per user)
    .handler(a.handler.function(createOrUpdateRating)),

  listRobotRatingsLambda: a
    .query()
    .arguments({
      robotId: a.string().required(),
      limit: a.integer(), // Pagination limit (default: 10)
      nextToken: a.string(), // Pagination token
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization handled in Lambda (filters sensitive data for non-admins)
    .handler(a.handler.function(listRobotRatings)),

  createRatingResponseLambda: a
    .mutation()
    .arguments({
      ratingId: a.string().required(),
      response: a.string().required(), // Partner's response text
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Authorization handled in Lambda (validates partner owns the robot)
    .handler(a.handler.function(createRatingResponse)),

  // Robot Reservation Management
  createRobotReservationLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot's robotId string (robot-XXXXXXXX)
      startTime: a.string().required(), // ISO datetime string
      endTime: a.string().required(), // ISO datetime string
      durationMinutes: a.integer().required(), // Duration in minutes (minimum 15)
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (validates user has sufficient credits, checks availability)
    .handler(a.handler.function(createRobotReservation)),

  listRobotReservationsLambda: a
    .query()
    .arguments({
      robotId: a.string(), // Optional: filter by robot
      userId: a.string(), // Optional: filter by user (only if requester is admin or the user themselves)
      partnerId: a.string(), // Optional: filter by partner (only if requester is admin or the partner themselves)
      status: a.string(), // Optional: filter by status ('pending', 'confirmed', 'active', 'completed', 'cancelled', 'refunded')
      startTime: a.string(), // Optional: filter reservations starting after this time (ISO datetime)
      endTime: a.string(), // Optional: filter reservations ending before this time (ISO datetime)
      limit: a.integer(), // Pagination limit (default: 20)
      nextToken: a.string(), // Pagination token
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (filters by user/partner ownership)
    .handler(a.handler.function(listRobotReservations)),

  cancelRobotReservationLambda: a
    .mutation()
    .arguments({
      reservationId: a.string().required(), // Reservation ID to cancel
      reason: a.string(), // Optional reason for cancellation
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (validates user owns reservation or is admin)
    .handler(a.handler.function(cancelRobotReservation)),

  checkRobotAvailabilityLambda: a
    .query()
    .arguments({
      robotId: a.string().required(), // Robot's robotId string
      startTime: a.string().required(), // ISO datetime string
      endTime: a.string().required(), // ISO datetime string
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda
    .handler(a.handler.function(checkRobotAvailability)),

  manageRobotAvailabilityLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot's robotId string
      action: a.string().required(), // 'create', 'update', or 'delete'
      availabilityId: a.string(), // Required for 'update' and 'delete'
      startTime: a.string(), // Required for 'create' and 'update' (ISO datetime)
      endTime: a.string(), // Required for 'create' and 'update' (ISO datetime)
      reason: a.string(), // Optional reason for the availability block
      isRecurring: a.boolean(), // Optional: if true, this is a recurring block
      recurrencePattern: a.string(), // Optional: JSON string describing recurrence
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (validates partner owns robot)
    .handler(a.handler.function(manageRobotAvailability)),

  processRobotReservationRefundsLambda: a
    .mutation()
    .arguments({
      checkAllReservations: a.boolean(), // Optional: if true, checks all confirmed/active reservations (admin only)
    })
    .returns(a.json())
    .authorization(allow => [allow.groups(['ADMINS'])]) // Only admins can trigger refund processing
    .handler(a.handler.function(processRobotReservationRefunds)),

  listPartnerPayoutsLambda: a
    .query()
    .arguments({
      partnerId: a.string(), // Optional: filter by partner
      robotId: a.string(), // Optional: filter by robot
      status: a.string(), // Optional: filter by status ('pending', 'paid', 'cancelled')
      limit: a.integer(), // Optional: pagination limit (default: 50)
      nextToken: a.string(), // Optional: pagination token
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (admins see all, partners see own)
    .handler(a.handler.function(listPartnerPayouts)),

  processPayoutLambda: a
    .mutation()
    .arguments({
      payoutIds: a.string().array().required(), // Array of payout IDs to process
    })
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (admins only)
    .handler(a.handler.function(processPayout)),

  getSessionLambda: a
    .query()
    .arguments({
      sessionId: a.string(),
    })
    .returns(SessionResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(getSessionLambda)),

  triggerConnectionCleanupLambda: a
    .mutation()
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (admins only)
    .handler(a.handler.function(triggerConnectionCleanup)),

  getActiveRobotsLambda: a
    .query()
    .returns(a.json())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (admins only)
    .handler(a.handler.function(getActiveRobots)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
