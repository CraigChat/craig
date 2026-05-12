import clsx from 'clsx';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { useEffect, useState } from 'react';

import Button from '../components/button';
import DropboxButton from '../components/dropboxButton';
import GoogleButton from '../components/googleButton';
import Link from '../components/link';
import MicrosoftButton from '../components/microsoftButton';
import { Modal } from '../components/modal';
import Section from '../components/section';
import SelectableRow from '../components/selectableRow';
import DropboxLogo from '../components/svg/dropbox';
import GoogleDriveLogo from '../components/svg/googleDrive';
import OneDriveLogo from '../components/svg/oneDrive';
import Toggle from '../components/toggle';
import prisma from '../lib/prisma';
import { getAvatarUrl, parseUser } from '../utils';
import { DiscordUser } from '../utils/types';

interface Props {
  user: DiscordUser;
  rewardTier: number | null;
  drive: DriveProps;
  googleDrive: boolean;
  microsoft: boolean;
  dropbox: boolean;
}

interface DriveProps {
  enabled: boolean;
  service: string;
  formats: string[];
}

interface FormatOption {
  title: string;
  value: string;
}

const formats: FormatOption[] = [
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
    value: 'flac-mix'
  },
  {
    title: 'AAC Single-Track Mix',
    value: 'aac-mix'
  },
  {
    title: 'Ogg Vorbis Single-Track Mix',
    value: 'vorbis-mix'
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

  const [loading, setLoading] = useState(false);
  const [drive, setDrive] = useState(props.drive);
  const [driveEnabled, setDriveEnabled] = useState(props.drive.enabled ?? false);
  const [driveFormats, setDriveFormats] = useState(props.drive.formats?.length ? props.drive.formats : ['flac-zip']);
  const [driveService, setDriveService] = useState(props.drive.service ?? 'google');

  const driveCanEnable =
    (driveService === 'google' && props.googleDrive) ||
    (driveService === 'onedrive' && props.microsoft) ||
    (driveService === 'dropbox' && props.dropbox);

  const benefitDate = new Date(Date.now() + 1000 * 60 * 60);
  benefitDate.setMinutes(0);
  benefitDate.setSeconds(0);
  benefitDate.setMilliseconds(0);

  // Use modal
  useEffect(() => {
    if (modalParsed) {
      return;
    }

    const p = new URLSearchParams(window.location.search);
    let title, content;
    if (p.get('error')) {
      const error = p.get('error');
      const from = p.get('from');
      // titlecase from
      if (from === 'google') {
        title = 'An error occurred while connecting to Google.';
      } else if (from === 'discord') {
        title = 'An error occurred while connecting to Discord.';
      } else if (from === 'microsoft') {
        title = 'An error occurred while connecting to Microsoft.';
      } else if (from === 'dropbox') {
        title = 'An error occurred while connecting to Dropbox.';
      } else {
        title = 'An error occurred.';
      }

      if (error === 'access_denied') {
        content = 'You denied access to your account.';
      } else if (error === 'invalid_scope') {
        content = 'You have provided partial permissions to Craig. Cloud backup will not work unless all permissions are checked.';
      } else {
        content = error;
      }
    }

    const r = p.get('r');
    if (r === 'google_linked') {
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
      content = (
        <span>
          You have unlinked your Microsoft account, but you can revoke app permissions in your{' '}
          <Link href="https://microsoft.com/consent">Microsoft settings</Link>.
        </span>
      );
    } else if (r === 'dropbox_unlinked') {
      title = 'Dropbox unlinked.';
      content = (
        <span>
          You have unlinked your Dropbox account, but you can revoke app permissions in your{' '}
          <Link href="https://www.dropbox.com/account/connected_apps">Dropbox settings</Link>.
        </span>
      );
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
    if (!drive) {
      return;
    }
    const selectedFormats = driveFormats.length ? driveFormats : ['flac-zip'];
    if (drive.enabled === driveEnabled && drive.formats.join(',') === selectedFormats.join(',') && drive.service === driveService) {
      return;
    }
    setLoading(true);
    fetch(`/api/user/drive`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        enabled: driveEnabled,
        formats: selectedFormats,
        service: driveService ?? 'google'
      })
    })
      .then(async (res) => {
        if (res.status === 200) {
          setDrive({
            ...drive,
            enabled: driveEnabled,
            formats: selectedFormats,
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
          setDriveFormats(drive.formats);
          setDriveService(drive.service);
        }
      })
      .catch((e) => {
        setLoading(false);
        setModalTitle('An error occurred.');
        setModalContent(`An error occurred while updating your drive settings.\n${e.message}`);
        setModalOpen(true);
      });
  }, [driveEnabled, driveFormats, driveService, drive]);

  function toggleDriveFormat(value: string, checked: boolean) {
    setDriveFormats((current) => {
      if (checked) {
        return current.includes(value) ? current : [...current, value];
      }
      if (current.length === 1) {
        return current;
      }
      return current.filter((format) => format !== value);
    });
  }

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
            <Section title="Cloud Backup" big>
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
                  <MicrosoftButton onClick={() => (location.href = '/api/microsoft/oauth')} />
                )}
              </SelectableRow>
              <SelectableRow
                title="Dropbox"
                icon={<DropboxLogo className="w-8 h-8" />}
                selected={drive.service === 'dropbox'}
                disabled={loading}
                hidden={!props.dropbox}
                onClick={() => setDriveService('dropbox')}
              >
                {props.dropbox ? (
                  <Button type="transparent" className="text-red-500" onClick={() => (location.href = '/api/dropbox/disconnect')}>
                    Disconnect
                  </Button>
                ) : (
                  <DropboxButton onClick={() => (location.href = '/api/dropbox/oauth')} />
                )}
              </SelectableRow>
              <div className="w-full flex flex-col gap-2">
                <span className="font-display">Formats</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {formats.map((format) => {
                    const checked = driveFormats.includes(format.value);
                    return (
                      <label
                        key={format.value}
                        className={clsx(
                          'flex items-center gap-3 rounded bg-zinc-800 bg-opacity-40 px-3 py-2 transition-colors',
                          loading ? 'opacity-50' : 'hover:bg-opacity-60'
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={loading || (checked && driveFormats.length === 1)}
                          checked={checked}
                          onChange={(e) => toggleDriveFormat(format.value, e.target.checked)}
                          className="h-4 w-4 accent-teal-600"
                        />
                        <span>{format.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </Section>
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

  if (!user) {
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const googleDrive = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });
  const microsoft = await prisma.microsoftUser.findUnique({ where: { id: user.id } });
  const dropbox = await prisma.dropboxUser.findUnique({ where: { id: user.id } });

  return {
    props: {
      user,
      rewardTier: dbUser?.rewardTier || 0,
      drive: {
        enabled: dbUser?.driveEnabled || false,
        service: dbUser?.driveService || 'google',
        formats: dbUser?.driveFormats?.length ? dbUser.driveFormats : ['flac-zip']
      },
      googleDrive: !!googleDrive,
      microsoft: !!microsoft,
      dropbox: !!dropbox
    }
  };
};
