import { serialize } from 'cookie';
import { config } from '../../utils/config';
import { NextApiRequest, NextApiResponse } from 'next';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader(
    'Set-Cookie',
    serialize(config.cookieName, '', {
      maxAge: -1,
      path: '/'
    })
  );

  res.redirect('/');
};
