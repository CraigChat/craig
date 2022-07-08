import { GetServerSideProps } from 'next';
import Head from 'next/head';

import Button from '../components/button';
import Link from '../components/link';
import LinkButton from '../components/linkButton';
import { parseUser } from '../utils';

export default function Login() {
  return (
    <>
      <Head>
        <title>Craig Dashboard</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta httpEquiv="Content-Language" content="en" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#2dd4bf" />
        <meta name="og:site_name" content="Craig" />
        <meta name="og:title" content="Craig Dashboard" />
        <meta name="og:description" content="The dashboard for Craig, a multi-track recording bot for Discord." />
        <meta name="og:locale" content="en_US" />
        <meta name="og:image" content="/android-chrome-512x512.png" />
        <meta name="msapplication-TileColor" content="#2dd4bf" />
        <meta name="theme-color" content="#2dd4bf" />
      </Head>
      <div className="min-h-screen bg-gradient-to-t from-neutral-800 to-zinc-900 text-white font-body flex items-center justify-center flex-col py-12 sm:px-12">
        <div className="bg-zinc-700 sm:rounded flex justify-center items-center sm:shadow-md w-full flex-col sm:w-4/5 sm:max-w-4xl">
          <h1 className="text-3xl flex justify-center p-3 gap-4 items-center relative bg-black bg-opacity-20 w-full font-body">
            <img crossOrigin="anonymous" src="https://craig.chat/craig.svg" className="w-12 h-12 rounded-full" />
            <span>Craig Dashboard</span>
          </h1>
          <div className="flex flex-col justify-center items-center p-6 gap-4 w-full">
            <div className="flex gap-2 flex-col w-full justify-center items-center">
              <span>
                This is the dashboard for <Link href="https://craig.chat">Craig</Link>, a multi-track voice recording bot for Discord.
              </span>
              <span>It's a simple dashboard, allowing you to link your Patreon for extra perks, and manage your cloud backup.</span>
              <br />
              <span>We use cookies to keep you logged in. By logging in, you allow us to store and use them.</span>
            </div>
            <Button type="brand" onClick={() => (location.href = '/api/login')}>
              Login
            </Button>
            <div className="flex gap-4 flex-wrap justify-center">
              <LinkButton name="Home" href="https://craig.chat/" />
              <LinkButton name="Privacy Policy" href="https://craig.chat/home/privacy.php" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async function (ctx) {
  const user = parseUser(ctx.req);

  if (user)
    return {
      redirect: {
        destination: '/',
        permanent: false
      }
    };

  return { props: {} };
};
