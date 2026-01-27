import type { Schema } from "../../data/resource";
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const handler: Schema["verifyStripePaymentLambda"]["functionHandler"] = async (event) => {
  const { sessionId } = event.arguments;

  if (!sessionId) {
    throw new Error("Missing required argument: sessionId");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      const errorMessage = session.payment_status === 'unpaid' 
        ? 'Payment was declined. Please check your payment method and try again.'
        : session.payment_status === 'no_payment_required'
        ? 'No payment was required for this session.'
        : `Payment not completed. Status: ${session.payment_status}`;
      
      return JSON.stringify({
        success: false,
        error: errorMessage,
        paymentStatus: session.payment_status,
        sessionId: session.id,
      });
    }

    const userId = session.metadata?.userId;
    if (!userId || userId !== identity.username) {
      throw new Error("Unauthorized: session userId does not match authenticated user");
    }

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
    throw new Error(`Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

