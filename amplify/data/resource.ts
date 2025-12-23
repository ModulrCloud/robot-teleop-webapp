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
import { processSessionPayment } from "../functions/process-session-payment/resource";

const LambdaResult = a.customType({
  statusCode: a.integer(),
  body: a.string(),
});

const RobotStatus = a.customType({
  isOnline: a.boolean(),
  lastSeen: a.integer(), // Optional by default in custom types
  status: a.string(), // Optional by default in custom types
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
    name: a.string().required(),
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

  // Admin audit log - tracks all admin assignments/removals
  AdminAudit: a.model({
    id: a.id(),
    action: a.string().required(), // 'ASSIGN_ADMIN' or 'REMOVE_ADMIN'
    adminUserId: a.string().required(), // Who performed the action
    targetUserId: a.string().required(), // Who was affected
    reason: a.string(), // Optional reason for the action
    timestamp: a.string().required(), // ISO timestamp
    metadata: a.json(), // Additional metadata (admin groups, counts, etc.)
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
    sessionId: a.string(), // Reference to the Session that generated this payout
    robotId: a.string().required(), // Robot that generated the earnings
    robotName: a.string(), // Robot name for display
    creditsEarned: a.float().required(), // Credits earned by partner (after markup)
    platformFee: a.float().required(), // Platform markup deducted
    totalCreditsCharged: a.float().required(), // Total credits charged to user
    durationSeconds: a.integer().required(), // Session duration
    status: a.string().required(), // 'pending', 'paid', 'cancelled'
    payoutDate: a.datetime(), // When payout was processed (if paid)
    createdAt: a.datetime().required(), // When session completed
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
    startedAt: a.datetime().required(),   // When session started
    endedAt: a.datetime(),                // When session ended
    durationSeconds: a.integer(),         // Total duration in seconds
    status: a.string(),                   // 'active', 'completed', 'disconnected'
    // Cost tracking
    creditsCharged: a.float(),            // Total credits charged to user (includes markup)
    partnerEarnings: a.float(),           // Credits earned by partner (after markup)
    platformFee: a.float(),               // Platform markup in credits
    hourlyRateCredits: a.float(),        // Robot's hourly rate at time of session (snapshot)
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"),
    index("partnerId").name("partnerIdIndex"),
    index("robotId").name("robotIdIndex")
  ])
  .authorization((allow) => [
    allow.owner().to(['create', 'read', 'update']),
    allow.groups(['ADMINS']).to(['read', 'delete']),
  ]),

  setUserGroupLambda: a
    .mutation()
    .arguments({
      group: a.string(),
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
      robotId: a.string().required(), // robotId (robot-XXXXXXXX format)
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

  addCreditsLambda: a
    .mutation()
    .arguments({
      userId: a.string().required(),
      credits: a.integer().required(),
      amountPaid: a.float(),
      currency: a.string(),
      tierId: a.string(),
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
    .authorization(allow => [allow.groups(['ADMINS'])]) // Only existing admins can assign admin
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
    .authorization(allow => [allow.groups(['ADMINS'])]) // Only admins can list admins
    .handler(a.handler.function(listAdmins))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
