import type { Schema } from "../../data/resource";
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

// Hardcoded tiers (will be replaced with database lookup later)
const TIERS: Record<string, { name: string; price: number; credits: number; bonusCredits: number }> = {
  '20': {
    name: 'Starter Pack',
    price: 20.00,
    credits: 2000,
    bonusCredits: 0,
  },
  '50': {
    name: 'Pro Pack',
    price: 50.00,
    credits: 5000,
    bonusCredits: 500,
  },
  '100': {
    name: 'Elite Pack',
    price: 100.00,
    credits: 10000,
    bonusCredits: 1500,
  },
};

export const handler: Schema["createStripeCheckoutLambda"]["functionHandler"] = async (event) => {
  console.log("Create Stripe Checkout request:", JSON.stringify(event, null, 2));
  
  const { tierId, userId } = event.arguments;

  if (!tierId || !userId) {
    throw new Error("Missing required arguments: tierId and userId");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Verify the userId matches the authenticated user
  if (identity.username !== userId) {
    throw new Error("Unauthorized: userId does not match authenticated user");
  }

  const tier = TIERS[tierId];
  if (!tier) {
    throw new Error(`Invalid tier ID: ${tierId}`);
  }

  try {
    // Get the frontend URL from environment or use a default
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const totalCredits = tier.credits + tier.bonusCredits;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: tier.name,
              description: `Get ${totalCredits.toLocaleString()} credits`,
            },
            unit_amount: Math.round(tier.price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
        tierId: tierId,
        credits: totalCredits.toString(),
        amountPaid: tier.price.toString(),
        currency: 'USD',
      },
      success_url: `${frontendUrl}/credits?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/credits?canceled=true`,
    });

    console.log("Stripe session created:", {
      id: session.id,
      url: session.url,
      status: session.status,
    });

    if (!session.url) {
      throw new Error("Stripe session created but no checkout URL returned");
    }

    return JSON.stringify({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Error creating Stripe checkout session:", error);
    throw new Error(`Failed to create checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

