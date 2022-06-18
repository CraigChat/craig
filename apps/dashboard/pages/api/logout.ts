import { serialize } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';

import { config } from '../../utils/config';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader(
    'Set-Cookie',
    serialize(config.cookieName, '', {
      maxAge: -1,
      path: '/'
    })
  );

  res.redirect('/login');
};
