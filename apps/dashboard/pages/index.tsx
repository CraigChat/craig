import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { useState } from 'react';

import Button from '../components/button';
import { DropdownItem } from '../components/dropdown';
import { Modal } from '../components/modal';
import { getAvatarUrl, parseUser } from '../utils';
import { DiscordUser } from '../utils/types';

interface Props {
  user: DiscordUser;
}

const formats: DropdownItem[] = [
  {
    title: 'Audacity Project',
    value: 'flac-aupzip'
  },
  {
    title: 'FLAC',
    value: 'flac-zip'
  },
  {
    title: 'AAC',
    value: 'aac-zip'
  },
  {
    title: 'FLAC Single-Track Mix',
    suffix: '($4 Tier)',
    value: 'flac-mix',
    tierRequired: 20
  },
  {
    title: 'AAC Single-Track Mix',
    suffix: '($4 Tier)',
    value: 'aac-mix',
    tierRequired: 20
  },
  {
    title: 'Ogg Vorbis Single-Track Mix',
    suffix: '($4 Tier)',
    value: 'vorbis-mix',
    tierRequired: 20
  },
  {
    title: 'Ogg FLAC',
    value: 'oggflac-zip'
  },
  {
    title: 'HE-AAC',
    value: 'heaac-zip'
  },
  {
    title: 'Opus',
    value: 'opus-zip'
  },
  {
    title: 'Ogg Vorbis',
    value: 'vorbis-zip'
  },
  {
    title: 'ADPCM wav',
    value: 'adpcm-zip'
  },
  {
    title: '8-bit wav',
    value: 'wav8-zip'
  }
];

export default function Index(props: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('Modal');
  const [modalContent, setModalContent] = useState('');

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
        <meta name="og:description" content="The multi-track recording bot for Discord." />
        <meta name="og:locale" content="en_US" />
        <meta name="og:image" content="/icon-512x512.png" />
        <meta name="msapplication-TileColor" content="#2dd4bf" />
        <meta name="theme-color" content="#2dd4bf" />
      </Head>
      <div className="min-h-screen bg-gradient-to-t from-neutral-800 to-zinc-900 text-white font-body flex items-center justify-center flex-col py-12 sm:px-12">
        <div className="bg-zinc-700 sm:rounded flex justify-center items-center sm:shadow-md w-full flex-col sm:w-4/5 sm:max-w-4xl">
          <h1 className="text-3xl flex justify-center p-3 gap-4 items-center relative bg-black bg-opacity-20 w-full font-body">
            <img src={getAvatarUrl(props.user)} className="w-12 h-12 rounded-full" />
            <span>
              Hello, <span className="font-medium">{props.user.username}</span>
              {!!props.user.discriminator && props.user.discriminator !== '0' ? <span className="opacity-50">#{props.user.discriminator}</span> : ''}
            </span>
          </h1>
          <div className="flex flex-col justify-center items-center p-6 gap-4 w-full">
            <div className="flex justify-center items-center gap-2 text-xl font-display">
              <span className="font-medium">Current Tier:</span>
            </div>
            <Button type="danger" onClick={() => (location.href = '/api/logout')}>
              Logout
            </Button>
          </div>
        </div>
      </div>
      <Modal open={modalOpen} title={modalTitle} setOpen={setModalOpen}>
        <div className="flex flex-col gap-2">
          <span>{modalContent}</span>
          <Button
            type="brand"
            onClick={() => {
              setModalOpen(false);
              history.replaceState(null, null, '/');
            }}
            className="w-fit"
          >
            Close
          </Button>
        </div>
      </Modal>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async function (ctx) {
  const user = parseUser(ctx.req);

  if (!user)
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };

  return {
    props: {
      user
    }
  };
};
