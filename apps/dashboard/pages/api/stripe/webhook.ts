import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import prisma from '../../../lib/prisma';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

// Disable body parsing, we need the raw body for webhook signature verification
export const config = {
  api: {
    bodyParser: false
  }
};

async function buffer(readable: any) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'transfer.created': {
        const transfer = event.data.object as Stripe.Transfer;
        const metadata = transfer.metadata;
        
        if (metadata?.userId && metadata?.type === 'payout') {
          // Find payout transaction by transfer ID
          const payout = await prisma.payoutTransaction.findFirst({
            where: { stripeTransferId: transfer.id }
          });

          if (payout) {
            await prisma.$transaction([
              // Update payout status to completed
              prisma.payoutTransaction.update({
                where: { id: payout.id },
                data: {
                  status: 'completed',
                  processedAt: new Date()
                }
              }),
              // Reduce pending payout amount
              prisma.user.update({
                where: { id: payout.userId },
                data: {
                  pendingPayoutCents: { decrement: payout.amountCents }
                }
              })
            ]);
          }
        }
        break;
      }

      case 'transfer.reversed': {
        const transfer = event.data.object as Stripe.Transfer;
        const metadata = transfer.metadata;
        
        if (metadata?.userId && metadata?.type === 'payout') {
          const payout = await prisma.payoutTransaction.findFirst({
            where: { stripeTransferId: transfer.id }
          });

          if (payout) {
            await prisma.$transaction([
              // Update payout status to failed
              prisma.payoutTransaction.update({
                where: { id: payout.id },
                data: {
                  status: 'failed',
                  processedAt: new Date()
                }
              }),
              // Refund the balance and reduce pending
              prisma.user.update({
                where: { id: payout.userId },
                data: {
                  balanceCents: { increment: payout.amountCents },
                  pendingPayoutCents: { decrement: payout.amountCents }
                }
              })
            ]);
          }
        }
        break;
      }

      case 'account.updated': {
        // Optionally handle account updates (e.g., when onboarding is completed)
        const account = event.data.object as Stripe.Account;
        const user = await prisma.user.findFirst({
          where: { stripeAccountId: account.id }
        });
        
        if (user && account.details_submitted && account.payouts_enabled) {
          // Account is ready for payouts
          console.log(`Stripe account ${account.id} is now ready for payouts`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

