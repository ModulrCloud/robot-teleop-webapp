# Stripe Checkout Customization Guide

## Modulr Yellow Color
- **Hex Code**: `#ffb700`
- **CSS Variable**: `var(--yellow)` or `--yellow: #ffb700`

## Stripe Checkout Customization

### 1. Dark Mode + Modulr Yellow Button

When creating a Stripe Checkout Session, you can customize the appearance:

```typescript
const session = await stripe.checkout.sessions.create({
  // ... other config ...
  appearance: {
    theme: 'dark', // Dark mode
    variables: {
      colorPrimary: '#ffb700', // Modulr yellow button
      colorBackground: '#10131a', // Modulr dark background
      colorText: '#ffffff',
      colorDanger: '#f44336',
      fontFamily: 'Inter, sans-serif',
      spacingUnit: '4px',
      borderRadius: '2px',
    },
  },
});
```

### 2. Available Customization Options

**Theme Options:**
- `'stripe'` - Default Stripe theme
- `'night'` - Dark theme (similar to dark mode)
- `'flat'` - Flat design
- `'none'` - No theme (use custom CSS)

**Color Variables:**
- `colorPrimary` - Primary button color (Modulr yellow: `#ffb700`)
- `colorBackground` - Background color
- `colorText` - Text color
- `colorDanger` - Error/danger color
- `colorSuccess` - Success color
- `colorWarning` - Warning color
- `colorTextSecondary` - Secondary text color

**Other Variables:**
- `fontFamily` - Font family
- `spacingUnit` - Spacing unit
- `borderRadius` - Border radius

### 3. Example Lambda Function

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

export const handler = async (event) => {
  const { tierId, userId } = JSON.parse(event.body);
  
  // Get tier from database
  const tier = await getCreditTier(tierId);
  
  // Calculate final price (with sale if applicable)
  const finalPrice = tier.isOnSale && tier.salePrice 
    ? tier.salePrice 
    : tier.basePrice;
  
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: tier.name,
            description: `Get ${tier.baseCredits + tier.bonusCredits} credits`,
          },
          unit_amount: Math.round(finalPrice * 100), // Convert to cents
        },
        quantity: 1,
      },
    ],
    customer_email: userEmail, // Optional: pre-fill email
    metadata: {
      userId: userId,
      tierId: tierId,
      credits: tier.baseCredits + tier.bonusCredits,
    },
    success_url: `${process.env.FRONTEND_URL}/credits?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/credits?canceled=true`,
    // Customization
    appearance: {
      theme: 'dark',
      variables: {
        colorPrimary: '#ffb700', // Modulr yellow
        colorBackground: '#10131a', // Modulr dark background
        colorText: '#ffffff',
        colorDanger: '#f44336',
        fontFamily: 'Inter, sans-serif',
        spacingUnit: '4px',
        borderRadius: '2px',
      },
    },
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({ sessionId: session.id, url: session.url }),
  };
};
```

### 4. Testing in Sandbox

Since you're in Stripe test mode:
- Use test card numbers: `4242 4242 4242 4242`
- Any future expiry date
- Any 3-digit CVC
- Any ZIP code

### 5. Webhook Configuration

For production, you'll need to:
1. Set up webhook endpoint in Stripe Dashboard
2. Point it to your Lambda function
3. Listen for `checkout.session.completed` event
4. Verify webhook signature
5. Update UserCredits and create CreditTransaction

## References
- [Stripe Checkout Customization](https://stripe.com/docs/payments/checkout/customization)
- [Stripe Appearance API](https://stripe.com/docs/api/checkout/sessions/create#create_checkout_session-appearance)

