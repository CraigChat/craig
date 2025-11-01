import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20'
});

const minimumPayoutCents = parseInt(process.env.STRIPE_MINIMUM_PAYOUT_CENTS || '1000', 10);

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = parseUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amountCents } = req.body;

    if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user from database
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check minimum payout amount
    if (amountCents < minimumPayoutCents) {
      return res.status(400).json({
        error: `Minimum payout is $${(minimumPayoutCents / 100).toFixed(2)}`
      });
    }

    // Check user has enough balance
    const availableBalance = dbUser.balanceCents - dbUser.pendingPayoutCents;
    if (amountCents > availableBalance) {
      return res.status(400).json({
        error: 'Insufficient balance',
        available: availableBalance
      });
    }

    // Check if user has Stripe account connected
    if (!dbUser.stripeAccountId) {
      return res.status(400).json({ error: 'Stripe account not connected' });
    }

    // Verify the Stripe account is ready for payouts
    const account = await stripe.accounts.retrieve(dbUser.stripeAccountId);
    if (!account.details_submitted || account.payouts_enabled !== true) {
      return res.status(400).json({
        error: 'Stripe account not fully set up. Please complete onboarding.'
      });
    }

    // Create transfer to connected account
    // In Stripe Connect, transfers move funds from platform to connected account
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: dbUser.stripeAccountId,
      metadata: {
        userId: user.id,
        type: 'payout'
      }
    });

    // Create payout transaction record
    const payout = await prisma.payoutTransaction.create({
      data: {
        userId: user.id,
        amountCents,
        gateway: 'stripe',
        status: 'processing',
        stripeTransferId: transfer.id,
        gatewayData: JSON.stringify({
          transferId: transfer.id,
          accountId: dbUser.stripeAccountId
        })
      }
    });

    // Update user balance
    await prisma.user.update({
      where: { id: user.id },
      data: {
        balanceCents: { decrement: amountCents },
        pendingPayoutCents: { increment: amountCents }
      }
    });

    res.json({
      success: true,
      payoutId: payout.id,
      transferId: transfer.id,
      amount: amountCents
    });
  } catch (error: any) {
    console.error('Stripe payout error:', error);
    
    // Handle Stripe-specific errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: error.message || 'Failed to process payout' });
  }
};

