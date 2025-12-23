import type { Schema } from "../../data/resource";
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

export const handler: Schema["verifyStripePaymentLambda"]["functionHandler"] = async (event) => {
  console.log("Verify Stripe Payment request:", JSON.stringify(event, null, 2));
  
  const { sessionId } = event.arguments;

  if (!sessionId) {
    throw new Error("Missing required argument: sessionId");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  try {
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log("Retrieved Stripe session:", {
      id: session.id,
      payment_status: session.payment_status,
      metadata: session.metadata,
    });

    // Verify payment was successful
    if (session.payment_status !== 'paid') {
      throw new Error(`Payment not completed. Status: ${session.payment_status}`);
    }

    // Verify the userId in metadata matches the authenticated user
    const userId = session.metadata?.userId;
    if (!userId || userId !== identity.username) {
      throw new Error("Unauthorized: session userId does not match authenticated user");
    }

    // Extract payment details from metadata
    const tierId = session.metadata?.tierId;
    const credits = parseInt(session.metadata?.credits || '0', 10);
    const amountPaid = parseFloat(session.metadata?.amountPaid || '0');
    const currency = session.metadata?.currency || 'USD';

    if (!tierId || credits <= 0) {
      throw new Error("Invalid session metadata: missing tierId or credits");
    }

    return JSON.stringify({
      success: true,
      userId,
      tierId,
      credits,
      amountPaid,
      currency,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Error verifying Stripe payment:", error);
    throw new Error(`Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

