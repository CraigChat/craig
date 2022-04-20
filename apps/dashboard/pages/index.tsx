import type { Patreon } from '@prisma/client';
import clsx from 'clsx';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { useEffect, useState } from 'react';

import Button from '../components/button';
import Dropdown, { DropdownItem } from '../components/dropdown';
import GoogleButton from '../components/googleButton';
import { Modal } from '../components/modal';
import Row from '../components/row';
import Section from '../components/section';
import SelectableRow from '../components/selectableRow';
import GoogleDriveLogo from '../components/svg/googleDrive';
import OneDriveLogo from '../components/svg/oneDrive';
import PatreonLogo from '../components/svg/patreon';
import Toggle from '../components/toggle';
import prisma from '../lib/prisma';
import { getAvatarUrl, parseUser } from '../utils';
import { DiscordUser } from '../utils/types';

interface Props {
  user: DiscordUser;
  rewardTier: number | null;
  patronId: string | null;
  patron: Patreon | null;
  drive: DriveProps;
  googleDrive: boolean;
  microsoft: boolean;
}

interface DriveProps {
  enabled: boolean;
  service: string;
  format: string;
  container: string;
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

const serviceNames: { [key: string]: string } = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  box: 'Box'
};

export default function Index(props: Props) {
  const [modalParsed, setModalParsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('Modal');
  const [modalContent, setModalContent] = useState('');

  const [patronUnlinkOpen, setPatronUnlinkOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [drive, setDrive] = useState(props.drive);
  const [driveEnabled, setDriveEnabled] = useState(props.drive.enabled ?? false);
  const [driveFormat, setDriveFormat] = useState(
    formats.find((f) => f.value === `${props.drive.format || 'flac'}-${props.drive.container || 'zip'}`) ?? formats[0]
  );
  const [driveService, setDriveService] = useState(props.drive.service ?? 'google');

  const driveCanEnable = (driveService === 'google' && props.googleDrive) || (driveService === 'onedrive' && props.microsoft);

  // Use modal
  useEffect(() => {
    if (modalParsed) return;

    const p = new URLSearchParams(window.location.search);
    let title, content;
    if (p.get('error')) {
      const error = p.get('error');
      const from = p.get('from');
      // titlecase from
      if (from === 'google') title = 'An error occurred while connecting to Google.';
      else if (from === 'patreon') title = 'An error occurred while connecting to Patreon.';
      else if (from === 'discord') title = 'An error occurred while connecting to Discord.';
      else if (from === 'microsoft') title = 'An error occurred while connecting to Microsoft.';
      else title = 'An error occurred.';

      if (error === 'access_denied') content = 'You denied access to your account.';
      else if (error === 'invalid_scope')
        content = 'You have provided partial permissions to Craig. Cloud backup will not work unless all permissions are checked.';
      else content = error;
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
    } else if (r === 'microsoft_linked') {
      title = 'Microsoft OneDrive linked!';
      content = 'You have successfully linked your Microsoft account.';
    } else if (r === 'google_unlinked') {
      title = 'Google Drive unlinked.';
      content = 'You have successfully unlinked your Google Drive account.';
    } else if (r === 'microsoft_unlinked') {
      title = 'Microsoft OneDrive unlinked.';
      content = 'You have successfully unlinked your Microsoft account.';
    }

    if (title && content) {
      setModalTitle(title);
      setModalContent(content);
      setModalOpen(true);
    }
    setModalParsed(true);
  });

  // Drive state update
  useEffect(() => {
    if (!drive) return;
    const [format, container] = driveFormat.value.split('-');
    if (drive.enabled === driveEnabled && format === drive.format && container === drive.container && drive.service === driveService) return;
    setLoading(true);
    fetch(`/api/user/drive`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        enabled: driveEnabled,
        format: format ?? 'flac',
        container: container ?? 'zip',
        service: driveService ?? 'google'
      })
    })
      .then(async (res) => {
        if (res.status === 200) {
          setDrive({
            ...drive,
            enabled: driveEnabled,
            format: format ?? 'flac',
            container: container ?? 'zip',
            service: driveService
          });
          setLoading(false);
        } else {
          const data = await res.json().catch(() => ({}));
          setLoading(false);
          setModalTitle('An error occurred.');
          setModalContent(`An error occurred while updating your drive settings.${data.error ? `\n${data.error}` : ''}`);
          setModalOpen(true);

          // Reset settings
          setDriveEnabled(drive.enabled);
          setDriveFormat(formats.find((f) => f.value === `${drive.format}-${drive.container}`) ?? formats[0]);
          setDriveService(drive.service);
        }
      })
      .catch((e) => {
        setLoading(false);
        setModalTitle('An error occurred.');
        setModalContent(`An error occurred while updating your drive settings.\n${e.message}`);
        setModalOpen(true);
      });
  }, [driveEnabled, driveFormat, driveService, drive]);

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
            <Row title="Patreon" icon={<PatreonLogo className="w-8 h-8 rounded-full" />}>
              {props.patronId ? (
                <Button type="transparent" className="text-red-500" onClick={() => setPatronUnlinkOpen(true)}>
                  Disconnect
                </Button>
              ) : (
                <Button type="brand" onClick={() => (location.href = '/api/patreon/oauth')}>
                  Connect
                </Button>
              )}
            </Row>
            <Section title="Cloud Backup" big>
              {props.rewardTier === 0 ? (
                <div className="w-full">
                  To enable cloud backup to services like Google Drive, you must be a patron. <br />
                  <a href="https://patreon.com/CraigRec" target="_blank" rel="noreferrer noopener" className="text-teal-500">
                    Become a patron
                  </a>
                </div>
              ) : (
                <>
                  <Toggle
                    label={`Upload Recordings to ${serviceNames[driveService] || 'Drive'}`}
                    description="Note: After your recording has finished, the recording will not be able to be downloaded while the recording is still uploading."
                    tooltip={!driveCanEnable ? 'You must link a service to your account to enable cloud backups.' : undefined}
                    className="w-full"
                    disabled={!driveCanEnable || loading}
                    checked={driveEnabled}
                    onToggle={setDriveEnabled}
                  />
                  <SelectableRow
                    title="Google Drive"
                    icon={<GoogleDriveLogo className="w-8 h-8" />}
                    selected={drive.service === 'google'}
                    disabled={loading}
                    hidden={!props.googleDrive}
                    onClick={() => setDriveService('google')}
                  >
                    {props.googleDrive ? (
                      <Button type="transparent" className="text-red-500" onClick={() => (location.href = '/api/google/disconnect')}>
                        Disconnect
                      </Button>
                    ) : (
                      <GoogleButton onClick={() => (location.href = '/api/google/oauth')} />
                    )}
                  </SelectableRow>
                  <SelectableRow
                    title="Microsoft OneDrive"
                    icon={<OneDriveLogo className="w-8 h-8" />}
                    selected={drive.service === 'onedrive'}
                    disabled={loading}
                    hidden={!props.microsoft}
                    onClick={() => setDriveService('onedrive')}
                  >
                    {props.microsoft ? (
                      <Button type="transparent" className="text-red-500" onClick={() => (location.href = '/api/microsoft/disconnect')}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button type="brand" onClick={() => (location.href = '/api/microsoft/oauth')}>
                        Connect
                      </Button>
                    )}
                  </SelectableRow>
                  <Dropdown
                    disabled={loading}
                    items={formats}
                    label="Format"
                    className={'w-full'}
                    full
                    selected={driveFormat}
                    onSelect={setDriveFormat}
                  />
                </>
              )}
            </Section>
            <Button type="danger" onClick={() => (location.href = '/api/logout')}>
              Logout
            </Button>
          </div>
        </div>
      </div>
      <Modal open={patronUnlinkOpen} title="Are you sure you want to unlink your Patreon account?" setOpen={setPatronUnlinkOpen}>
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
  const microsoft = await prisma.microsoftUser.findUnique({ where: { id: user.id } });

  return {
    props: {
      user,
      rewardTier: dbUser?.rewardTier || 0,
      patronId: dbUser?.patronId || null,
      patron,
      drive: {
        enabled: dbUser?.driveEnabled || false,
        service: dbUser?.driveService || 'google',
        format: dbUser?.driveFormat || 'flac',
        container: dbUser?.driveContainer || 'zip'
      },
      googleDrive: !!googleDrive,
      microsoft: !!microsoft
    }
  };
};
