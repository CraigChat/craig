import { Icon } from '@iconify/react';
import avatarsIcon from '@iconify-icons/ic/baseline-burst-mode';
import downloadIcon from '@iconify-icons/ic/baseline-download';
import expiryIcon from '@iconify-icons/ic/outline-timer';
import audioIcon from '@iconify-icons/ic/round-audio-file';
import imageIcon from '@iconify-icons/ic/round-image';
import clsx from 'clsx';
import { Fragment, h } from 'preact';
import { useTranslation } from 'react-i18next';

import { CookAvatarsPayload, ReadyState, RecordingInfo, RecordingUser } from '../api';
import prettyMs from '../prettyMs';
import { getDownloadsSection, getOtherFormatsSection, SectionButton } from '../sections';
import { asT, PlatformInfo } from '../util';
import DiscordElement from './discordElement';
import DownloadButton from './downloadButton';
import GlowersSection from './glowersSection';
import PreviouslyDownloaded from './previouslyDownloaded';
import Section from './section';

const EXPIRY_WARN_AT = 1000 * 60 * 60 * 3;

interface RecordingProps {
  state: {
    recording: RecordingInfo;
    recordingId: string | number;
    users: RecordingUser[];
    durationLoading: boolean;
    duration: number | null;
    platform: PlatformInfo;
    readyState: ReadyState | null;
    downloading: boolean;
    showPreviousDownload: boolean;
  };
  onDurationClick?(e: MouseEvent): any;
  onDownloadClick?(button: SectionButton, e: MouseEvent): any;
  onAvatarsClick?(payload: CookAvatarsPayload, e: MouseEvent): any;
  onDeleteClick?(e: MouseEvent): any;
}

export default function Recording({ state, onDurationClick, onDownloadClick, onDeleteClick, onAvatarsClick }: RecordingProps) {
  const { t } = useTranslation();
  const recording = state.recording;
  const startDate = new Date(recording.startTime);
  const expiryDate = new Date(startDate.valueOf() + 1000 * 60 * 60 * (recording.expiresAfter || 24));
  const expiryTime = expiryDate.valueOf() - Date.now();
  const downloadsSection = getDownloadsSection(recording, state.platform);
  const othersSection = getOtherFormatsSection(recording, state.platform);

  return (
    <Fragment>
      {/* Info Box */}
      <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-sm text-zinc-200">
        <div>
          <span class="text-zinc-100 font-display">{t('info.rec_id')}:</span> <span class="font-mono">{state.recordingId}</span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">{t('info.req_by')}:</span>
            {recording.requesterExtra ? <DiscordElement {...recording.requesterExtra} id={recording.requesterId} /> : recording.requester}
            {recording.user ? (
              <Fragment>
                <span class="text-zinc-400 font-medium">{t('info.behalf')}</span>
                {recording.userExtra ? <DiscordElement {...recording.userExtra} id={recording.userId} /> : recording.user}
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
            {recording.channelExtra ? <DiscordElement {...recording.channelExtra} elementType="channel" /> : recording.channel}
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
              <button onClick={onDurationClick} class="font-medium text-zinc-400 hover:underline focus:underline outline-none">
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

      {!state.downloading && state.readyState && state.showPreviousDownload ? (
        <PreviouslyDownloaded readyState={state.readyState} users={state.users} recording={state.recording} platform={state.platform} />
      ) : (
        ''
      )}

      {/* Expiry Block */}
      <div class="flex flex-col items-center justify-center">
        {recording.expiresAfter && expiryTime > 0 ? (
          <h2
            class={clsx('sm:text-2xl text-lg font-display flex items-center justify-center gap-2', {
              'text-zinc-100': expiryTime > EXPIRY_WARN_AT,
              'text-red-500': expiryTime <= EXPIRY_WARN_AT
            })}
          >
            <Icon icon={expiryIcon} className="sm:text-3xl text-xl" />
            <span>{t('info.expires', { expire: prettyMs(expiryTime, { compact: true, verbose: true, t }) })}</span>
          </h2>
        ) : (
          ''
        )}
        <button onClick={onDeleteClick} class="text-zinc-400 font-medium hover:text-red-500 focus:text-red-500 outline-none active:underline">
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
        {recording.features.glowers ? <GlowersSection platform={state.platform} users={state.users} onDownload={onAvatarsClick} /> : ''}
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
