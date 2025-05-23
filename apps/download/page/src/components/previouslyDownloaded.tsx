import { Icon } from '@iconify/react';
import infoIcon from '@iconify-icons/ic/baseline-info';
import warnIcon from '@iconify-icons/ic/round-warning';
import { h } from 'preact';
import { useTranslation } from 'react-i18next';
import { getDownloadsSection, getOtherFormatsSection, SectionButton } from 'src/sections';
import { asT, PlatformInfo } from 'src/util';

import { ReadyState, RecordingInfo, RecordingUser } from '../api';
import DiscordElement from './discordElement';
import ModalButtonDownloadLink from './modalButtonDownloadLink';
import Spinner from './spinner';

interface PreviouslyDownloadedProps {
  recording: RecordingInfo;
  platform: PlatformInfo;
  readyState: ReadyState | null;
  users: RecordingUser[];
}

type ExtraSectionButton = SectionButton & { section: any };

export default function PreviouslyDownloaded({ recording, platform, readyState, users }: PreviouslyDownloadedProps) {
  const { t } = useTranslation();
  const downloadsSection = getDownloadsSection(recording, platform);
  const othersSection = getOtherFormatsSection(recording, platform);
  const button = [...downloadsSection, ...othersSection]
    .reduce(
      (p, v) => [
        ...p,
        ...v.buttons.map((b: ExtraSectionButton) => {
          b.section = v.title;
          return b;
        })
      ],
      [] as ExtraSectionButton[]
    )
    .find((b) => (b.format || 'flac') === readyState.download?.format && (b.container || 'zip') === readyState.download?.container);
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

  return readyState.ready ? (
    <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-sm text-zinc-200">
      <div class="flex flex-col">
        <div class="flex gap-2 items-center">
          <Icon icon={infoIcon} className="w-8 h-8" />
          <h2 class="font-display text-lg font-medium">Previous Download</h2>
        </div>
        <span>If you started this download mid-recording, you should start a new download to get the most up-to-date audio.</span>
      </div>
      <div class="flex flex-col">
        {button ? (
          <h3 class="font-medium text-lg">
            {asT(t, button.section)} / {asT(t, button.text)}
          </h3>
        ) : (
          ''
        )}
        <div class="flex">
          <ModalButtonDownloadLink key={1} file={readyState.download.file} href={`/dl/${readyState.download.file}`}>
            {t('modal_content.download')}
          </ModalButtonDownloadLink>
        </div>
      </div>
    </div>
  ) : (
    <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-sm text-zinc-200">
      <div class="flex flex-col">
        <div class="flex gap-2 items-center">
          <Icon icon={warnIcon} className="w-8 h-8" />
          <h2 class="font-display text-lg font-medium">A download is being processed already!</h2>
        </div>
        <span>You will have to wait until this download is processed before starting a new one.</span>
      </div>
      <div class="flex flex-col">
        {button ? (
          <h3 class="font-medium text-lg">
            {asT(t, button.section)} / {asT(t, button.text)}
          </h3>
        ) : (
          ''
        )}
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
    </div>
  );
}
