import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { useState } from 'react';
import clsx from 'clsx';
import { DiscordUser } from '../utils/types';
import { getAvatarUrl, parseUser } from '../utils';
import Button from '../components/button';
import type { GoogleDriveUser, Patreon } from '@prisma/client';
import Row from '../components/row';
import prisma from '../lib/prisma';
import Section from '../components/section';
import { Modal } from '../components/modal';
import { useEffect } from 'react';
import Toggle from '../components/toggle';
import Dropdown, { DropdownItem } from '../components/dropdown';
import { Tooltip } from 'react-tippy';

interface Props {
  user: DiscordUser;
  rewardTier: number | null;
  patronId: string | null;
  patron: Patreon | null;
  googleDrive: GoogleDriveUser | null;
}

const tierNames: { [key: number]: string } = {
  [-1]: 'Greater Weasel',
  0: 'Default',
  10: 'Supporter',
  20: 'Better Supporter',
  30: 'FLAC Demander',
  100: 'MP3 God'
};

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
  const [modalParsed, setModalParsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('Modal');
  const [modalContent, setModalContent] = useState('');

  const [patronUnlinkOpen, setPatronUnlinkOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [drive, setDrive] = useState(props.googleDrive);
  const [driveEnabled, setDriveEnabled] = useState(props.googleDrive?.enabled ?? false);
  const [driveFormat, setDriveFormat] = useState(
    formats.find(
      (f) => f.value === `${props.googleDrive?.format || 'flac'}-${props.googleDrive?.container || 'zip'}`
    ) ?? formats[0]
  );

  useEffect(() => {
    if (modalParsed) return;

    const p = new URLSearchParams(window.location.search);
    let title, content;
    if (p.get('error')) {
      const error = p.get('error');
      const from = p.get('from');
      if (from === 'google') title = 'An error occurred while connecting to Google Drive.';
      else if (from === 'patreon') title = 'An error occurred while connecting to Patreon.';
      else if (from === 'discord') title = 'An error occurred while connecting to Discord.';
      else title = 'An error occurred.';

      if (error === 'access_denied') content = 'You denied access to your Google Drive account.';
      else if (error === 'invalid_scope')
        content =
          'You have provided partial permissions to Craig. Google Drive integration will not work unless both permissions are checked.';
      else content = p.get('error');
    }

    const r = p.get('r');
    if (r === 'patreon_linked') {
      title = 'Patreon linked!';
      content = 'You have successfully linked your Patreon account. It may take up to an hour for your tier to update.';
    } else if (r === 'patreon_unlinked') {
      title = 'Patreon unlinked.';
      content = 'You have successfully unlinked your Patreon account.';
    } else if (r === 'google_linked') {
      title = 'Google Drive linked!';
      content = 'You have successfully linked your Google Drive account.';
    } else if (r === 'google_unlinked') {
      title = 'Google Drive unlinked.';
      content = 'You have successfully unlinked your Google Drive account.';
    }

    if (title && content) {
      setModalTitle(title);
      setModalContent(content);
      setModalOpen(true);
    }
    setModalParsed(true);
  });

  useEffect(() => {
    if (!props.googleDrive || !drive) return;
    const [format, container] = driveFormat.value.split('-');
    if (drive.enabled === driveEnabled && format === drive.format && container == drive.container) return;
    setLoading(true);
    fetch(`/api/user/drive`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        enabled: driveEnabled,
        format: format ?? 'flac',
        container: container ?? 'zip'
      })
    })
      .then((res) => {
        if (res.status === 200) {
          setDrive({
            ...drive,
            enabled: driveEnabled,
            format: format ?? 'flac',
            container: container ?? 'zip'
          });
          setLoading(false);
        }
      })
      .catch(() => {
        setLoading(false);
      });
  }, [driveEnabled, driveFormat, drive]);

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
        <meta name="msapplication-TileColor" content="#2dd4bf" />
        <meta name="theme-color" content="#2dd4bf" />
      </Head>
      <div className="min-h-screen bg-gradient-to-t from-neutral-800 to-zinc-900 text-white font-body flex items-center justify-center flex-col py-12 sm:px-12">
        <div className="bg-zinc-700 sm:rounded flex justify-center items-center sm:shadow-md w-full flex-col sm:w-4/5 sm:max-w-4xl">
          <h1 className="text-3xl flex justify-center p-3 gap-4 items-center relative bg-black bg-opacity-20 w-full font-body">
            <img src={getAvatarUrl(props.user)} className="w-12 h-12 rounded-full" />
            <span>
              Hello, <span className="font-medium">{props.user.username}</span>
              <span className="opacity-50">#{props.user.discriminator}</span>
            </span>
          </h1>
          <div className="flex flex-col justify-center items-center p-6 gap-4 w-full">
            <div className="flex justify-center items-center gap-2 text-xl font-display">
              <span className="font-medium">Current Tier:</span>
              <span
                className={clsx({
                  'text-amber-500 font-medium': props.rewardTier === -1,
                  'opacity-50': props.rewardTier === 0,
                  'text-teal-500 font-medium': props.rewardTier > 0
                })}
              >
                {tierNames[props.rewardTier] ?? `#${props.rewardTier}`}
              </span>
            </div>
            <Row title="Patreon" icon="/patreon.svg">
              {props.patronId ? (
                <Button type="danger" onClick={() => setPatronUnlinkOpen(true)}>
                  Disconnect
                </Button>
              ) : (
                <Button type="brand" onClick={() => (location.href = '/api/patreon/oauth')}>
                  Connect
                </Button>
              )}
            </Row>
            <Section title="Google Drive">
              <Row title="Google" icon="/google.svg">
                {props.googleDrive ? (
                  <Button type="danger" onClick={() => (location.href = '/api/google/disconnect')}>
                    Disconnect
                  </Button>
                ) : (
                  <Tooltip
                    disabled={props.rewardTier !== 0}
                    title="You must be a patron to connect to your Google Drive."
                  >
                    <Button
                      disabled={props.rewardTier === 0}
                      type="brand"
                      onClick={() => (location.href = '/api/google/oauth')}
                    >
                      Connect
                    </Button>
                  </Tooltip>
                )}
              </Row>
              {props.googleDrive ? (
                <>
                  <Toggle
                    label="Upload Recordings to Google Drive"
                    description="Note: After your recording has finished, the recording will not be able to be downloaded while the recording is still uploading."
                    className="w-full"
                    disabled={props.rewardTier === 0 || loading}
                    tooltip={props.rewardTier === 0 ? 'You must be a patron to enable this feature.' : undefined}
                    checked={driveEnabled}
                    onToggle={setDriveEnabled}
                  />
                  <Dropdown
                    disabled={loading}
                    items={formats}
                    label="Format"
                    className={clsx('w-full', { hidden: !driveEnabled })}
                    full
                    selected={driveFormat}
                    onSelect={setDriveFormat}
                  />
                </>
              ) : (
                ''
              )}
            </Section>
            <Button type="danger" onClick={() => (location.href = '/api/logout')}>
              Logout
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={patronUnlinkOpen}
        title="Are you sure you want to unlink your Patreon account?"
        setOpen={setPatronUnlinkOpen}
      >
        <div className="flex flex-col gap-2">
          <span>Your benefits will be revoked if you unlink your Patreon.</span>
          <div className="flex gap-2 items-center">
            <Button type="brand" onClick={() => (location.href = '/api/patreon/disconnect')} className="w-fit">
              Unlink
            </Button>
            <Button onClick={() => setPatronUnlinkOpen(false)} className="w-fit">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
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
        destination: '/api/login',
        permanent: false
      }
    };

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const patron = dbUser && dbUser.patronId ? await prisma.patreon.findUnique({ where: { id: dbUser.patronId } }) : null;
  const googleDrive = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });

  return {
    props: { user, rewardTier: dbUser?.rewardTier || 0, patronId: dbUser?.patronId || null, patron, googleDrive }
  };
};
