import { h } from 'preact';
import { useTranslation } from 'react-i18next';

import { ReadyState, RecordingUser } from '../api';
import { SectionButton } from '../sections';
import { asT } from '../util';
import DiscordElement from './discordElement';
import ModalContent from './modalContent';
import Spinner from './spinner';

interface DownloadingModalContentProps {
  readyState: ReadyState | null;
  button?: SectionButton;
  avatars?: boolean;
  users: RecordingUser[];
}

export default function DownloadingModalContent({ readyState, button, avatars, users }: DownloadingModalContentProps) {
  const { t } = useTranslation();
  let fileElement: any = <span>{readyState && readyState.file ? `${readyState.file}:` : t('modal_content.download_processing')}</span>;
  let fileIndex = -1;

  if (readyState && readyState.file) {
    const [trackIndex, other] = readyState.file.split('-');
    const user = users[parseInt(trackIndex, 10) - 1];
    if (other && user) {
      fileElement = <DiscordElement {...user} />;
      fileIndex = parseInt(trackIndex, 10);
    }
  }

  // Set text to "processing" if there is no file involved (single-track smart mix)
  if (readyState && !readyState.file && readyState.time) fileElement = <span>{t('processing')}</span>;

  return (
    <ModalContent title={t('downloading')}>
      <div class="flex flex-col gap-4">
        <p>{avatars ? t('modal_content.downloading_avatar') : t('modal_content.downloading', { format: asT(t, button!.text) })}</p>
        <div class="flex gap-2 items-center">
          <Spinner />
          {fileIndex !== -1 ? (
            <span class="font-display">
              [{fileIndex}/{users.length}]
            </span>
          ) : (
            ''
          )}
          {fileElement}
          {readyState && (readyState.file || readyState.progress) ? (
            <span class="font-display">{readyState.progress ? `${readyState.progress}%` : '...'}</span>
          ) : (
            ''
          )}
          {readyState && readyState.time ? <code class="font-mono opacity-75 text-sm">- {readyState.time}</code> : ''}
        </div>
      </div>
    </ModalContent>
  );
}
