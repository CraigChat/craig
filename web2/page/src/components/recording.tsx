import { Fragment, h } from 'preact';
import { Icon } from '@iconify/react';
import prettyMs from 'pretty-ms';
import DiscordElement from './discordElement';
import Section from './section';
import DownloadButton from './downloadButton';
import { CookAvatarsPayload, RecordingInfo, RecordingUser } from '../api';
import { PlatformInfo, asT } from '../util';
import { getDownloadsSection, getOtherFormatsSection, SectionButton } from '../sections';
import downloadIcon from '@iconify-icons/ic/baseline-download';
import avatarsIcon from '@iconify-icons/ic/baseline-burst-mode';
import imageIcon from '@iconify-icons/ic/round-image';
import audioIcon from '@iconify-icons/ic/round-audio-file';
import expiryIcon from '@iconify-icons/ic/outline-timer';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

const EXPIRY_WARN_AT = 1000 * 60 * 60 * 3;

interface RecordingProps {
  state: {
    recording: RecordingInfo;
    recordingId: string | number;
    users: RecordingUser[];
    durationLoading: boolean;
    duration: number | null;
    platform: PlatformInfo;
  };
  onDurationClick?(e: MouseEvent): any;
  onDownloadClick?(button: SectionButton, e: MouseEvent): any;
  onAvatarsClick?(payload: CookAvatarsPayload, e: MouseEvent): any;
  onDeleteClick?(e: MouseEvent): any;
}

export default function Recording({
  state,
  onDurationClick,
  onDownloadClick,
  onDeleteClick,
  onAvatarsClick
}: RecordingProps) {
  const { t } = useTranslation();
  const recording = state.recording;
  const startDate = new Date(recording.startTime);
  const expiryDate = new Date(startDate.valueOf() + 1000 * 60 * 60 * (recording.expiresAfter || 24));
  const expiryTime = expiryDate.valueOf() - startDate.valueOf();
  const downloadsSection = getDownloadsSection(recording, state.platform);
  const othersSection = getOtherFormatsSection(recording, state.platform);

  return (
    <Fragment>
      {/* Info Box */}
      <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-sm text-zinc-200">
        <div>
          <span class="text-zinc-100 font-display">{t('info.rec_id')}:</span>{' '}
          <span class="font-mono">{state.recordingId}</span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">{t('info.req_by')}:</span>
            {recording.requesterExtra ? <DiscordElement {...recording.requesterExtra} /> : recording.requester}
            {recording.user ? (
              <Fragment>
                <span class="text-zinc-400 font-medium">{t('info.behalf')}</span>
                {recording.userExtra ? <DiscordElement {...recording.userExtra} /> : recording.user}
              </Fragment>
            ) : (
              ''
            )}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">{t('info.server')}:</span>
            {recording.guildExtra ? <DiscordElement {...recording.guildExtra} /> : recording.guild}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">{t('info.channel')}:</span>
            {recording.channelExtra ? (
              <DiscordElement {...recording.channelExtra} elementType="channel" />
            ) : (
              recording.channel
            )}
          </div>
          <div>
            <span class="text-zinc-100 font-display">{t('info.started')}:</span> {startDate.toLocaleString()}
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <div>
            <span class="text-zinc-100 font-display">{t('info.duration')}:</span>{' '}
            {state.durationLoading ? (
              <span class="font-medium text-zinc-400">{t('loading')}</span>
            ) : state.duration === null ? (
              <button
                onClick={onDurationClick}
                class="font-medium text-zinc-400 hover:underline focus:underline outline-none"
              >
                {t('reveal')}
              </button>
            ) : (
              <span>{prettyMs(state.duration * 1000)}</span>
            )}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">{t('info.users')}:</span>
            {state.users.map((user) => (
              <DiscordElement {...user} key={user.id} />
            ))}
          </div>
        </div>
      </div>

      {/* Expiry Block */}
      <div class="flex flex-col items-center justify-center">
        {recording.expiresAfter ? (
          <h2
            class={clsx('text-2xl font-display flex items-center justify-center gap-2', {
              'text-zinc-100': expiryTime > EXPIRY_WARN_AT,
              'text-red-500': expiryTime <= EXPIRY_WARN_AT
            })}
          >
            <Icon icon={expiryIcon} className="text-3xl" /> {/* TODO localize pretty ms */}
            <span>{t('info.expires', { expire: prettyMs(expiryTime, { compact: true, verbose: true }) })}.</span>
          </h2>
        ) : (
          ''
        )}
        <button
          onClick={onDeleteClick}
          class="text-zinc-400 font-medium hover:text-red-500 focus:text-red-500 outline-none active:underline"
        >
          {t('info.delete_rec')}
        </button>
      </div>

      {/* Downloads */}
      <Section title={t('sections.dl')} icon={downloadIcon}>
        {downloadsSection.map((section, i) => (
          <Section title={asT(t, section.title)} icon={section.icon} small key={i}>
            <div class="flex flex-row flex-wrap gap-3">
              {section.buttons.map((button, ii) =>
                button.hidden ? (
                  ''
                ) : (
                  <DownloadButton
                    icon={button.icon}
                    title={asT(t, button.text)}
                    suffix={asT(t, button.suffix)}
                    ennuizel={button.ennuizel !== undefined}
                    key={ii}
                    onClick={(e) => onDownloadClick(button, e)}
                  />
                )
              )}
            </div>
          </Section>
        ))}
      </Section>

      {/* Avatars */}
      <Section title={t('sections.avatars')} icon={avatarsIcon} collapsable collapsed>
        <div class="flex flex-row flex-wrap gap-3">
          <DownloadButton icon={imageIcon} onClick={(e) => onAvatarsClick({}, e)} title="PNG" />
        </div>
      </Section>

      {/* Other Formats */}
      <Section title={t('sections.other_formats')} icon={audioIcon} collapsable collapsed>
        {othersSection.map((section, i) => (
          <Section title={asT(t, section.title)} icon={section.icon} small key={i}>
            <div class="flex flex-row flex-wrap gap-3">
              {section.buttons.map((button, ii) =>
                button.hidden ? (
                  ''
                ) : (
                  <DownloadButton
                    icon={button.icon}
                    title={asT(t, button.text)}
                    suffix={asT(t, button.suffix)}
                    ennuizel={button.ennuizel !== undefined}
                    key={ii}
                    onClick={(e) => onDownloadClick(button, e)}
                  />
                )
              )}
            </div>
          </Section>
        ))}
      </Section>
    </Fragment>
  );
}
