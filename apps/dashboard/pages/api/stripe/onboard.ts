import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = parseUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user already has a Stripe account
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (dbUser?.stripeAccountId) {
      // Create an account link to update/access existing account
      const accountLink = await stripe.accountLinks.create({
        account: dbUser.stripeAccountId,
        refresh_url: `${process.env.APP_URI || 'http://localhost:3222'}/settings?stripe=error`,
        return_url: `${process.env.APP_URI || 'http://localhost:3222'}/settings?stripe=success`,
        type: 'account_onboarding'
      });
      return res.json({ url: accountLink.url });
    }

    // Create a new Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // Default to US, can be made configurable
      capabilities: {
        transfers: { requested: true }
      },
      // Metadata to track which user this account belongs to
      metadata: {
        userId: user.id
      }
    });

    // Save the account ID to the user
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeAccountId: account.id }
    });

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.APP_URI || 'http://localhost:3222'}/settings?stripe=error`,
      return_url: `${process.env.APP_URI || 'http://localhost:3222'}/settings?stripe=success`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (error: any) {
    console.error('Stripe onboarding error:', error);
    res.status(500).json({ error: error.message || 'Failed to create Stripe account' });
  }
};

