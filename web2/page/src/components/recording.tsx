import { Fragment, h } from 'preact';
import { Icon } from '@iconify/react';
import prettyMs from 'pretty-ms';
import DiscordElement from './discordElement';
import Section from './section';
import DownloadButton from './downloadButton';
import { RecordingInfo, RecordingUser } from '../api';
import { PlatformInfo } from '../util';
import { getDownloadsSection, getOtherFormatsSection, SectionButton } from '../sections';
import downloadIcon from '@iconify-icons/ic/baseline-download';
import avatarsIcon from '@iconify-icons/ic/baseline-burst-mode';
import audioIcon from '@iconify-icons/ic/round-audio-file';
import expiryIcon from '@iconify-icons/ic/outline-timer';
import clsx from 'clsx';

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
  onDeleteClick?(e: MouseEvent): any;
}

export default function Recording({ state, onDurationClick, onDownloadClick, onDeleteClick }: RecordingProps) {
  const recording = state.recording;
  const startDate = new Date(recording.startTime);
  const expiryDate = new Date(startDate.valueOf() + (1000 * 60 * 60 * (recording.expiresAfter || 24)));
  const expiryTime = expiryDate.valueOf() - startDate.valueOf();
  const downloadsSection = getDownloadsSection(recording, state.platform);
  const othersSection = getOtherFormatsSection(recording, state.platform);

  return (
    <Fragment>
      {/* Info Box */}
      <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-sm text-zinc-200">
        <div>
          <span class="text-zinc-100 font-display">Recording ID:</span>{' '}
          <span class="font-mono">{state.recordingId}</span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">Requested By:</span>
            {recording.requesterExtra ? <DiscordElement {...recording.requesterExtra} /> : recording.requester}
            {recording.user ? (
              <Fragment>
                <span class="text-zinc-400 font-medium">on behalf of</span>
                {recording.userExtra ? <DiscordElement {...recording.userExtra} /> : recording.user}
              </Fragment>
            ) : ''}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">Server:</span>
            {recording.guildExtra ? <DiscordElement {...recording.guildExtra} /> : recording.guild}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">Channel:</span>
            {recording.channelExtra ? <DiscordElement {...recording.channelExtra} elementType="channel" /> : recording.channel}
          </div>
          <div>
            <span class="text-zinc-100 font-display">Started At:</span>{' '}
            {startDate.toLocaleString()}
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <div>
            <span class="text-zinc-100 font-display">Duration:</span>{' '}
            {state.durationLoading ? <span class="font-medium text-zinc-400">Loading...</span> : (
              state.duration === null
                ? <button onClick={onDurationClick} class="font-medium text-zinc-400 hover:underline focus:underline outline-none">Reveal</button>
                : <span>{prettyMs(state.duration * 1000)}</span>
            )}
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-zinc-100 font-display">User(s):</span>
            {state.users.map((user) => <DiscordElement {...user} key={user.id} />)}
          </div>
        </div>
      </div>

      {/* Expiry Block */}
      <div class="flex flex-col items-center justify-center">
        {recording.expiresAfter
          ? <h2 class={clsx('text-2xl font-display', {
            'text-zinc-100': expiryTime > EXPIRY_WARN_AT,
            'text-red-500': expiryTime <= EXPIRY_WARN_AT
          })}><Icon icon={expiryIcon}/> Recording expires in {prettyMs(expiryTime, { compact: true, verbose: true })}.</h2>
          : ''}
        <button
          onClick={onDeleteClick}
          class="text-zinc-400 font-medium hover:text-red-500 focus:text-red-500 outline-none active:underline"
        >
          Delete Recording
        </button>
      </div>

      {/* Downloads */}
      <Section title="Downloads" icon={downloadIcon}>
        {downloadsSection.map((section, i) => (<Section title={section.title} icon={section.icon} small key={i}>
          <div class="flex flex-row flex-wrap gap-3">
            {section.buttons.map((button, ii) => (button.hidden ? '' : <DownloadButton
              icon={button.icon}
              title={button.text}
              suffix={button.suffix}
              ennuizel={button.ennuizel !== undefined}
              key={ii}
              onClick={(e) => onDownloadClick(button, e)}
            />))}
          </div>
        </Section>))}
      </Section>

      {/* Avatars */}
      <Section title="Avatars" icon={avatarsIcon} collapsable collapsed>
        <div class="flex flex-row flex-wrap gap-3">
          <DownloadButton title="TODO" />
        </div>
      </Section>

      {/* Other Formats */}
      <Section title="Other formats" icon={audioIcon} collapsable collapsed>
        {othersSection.map((section, i) => (<Section title={section.title} icon={section.icon} small key={i}>
          <div class="flex flex-row flex-wrap gap-3">
            {section.buttons.map((button, ii) => (button.hidden ? '' : <DownloadButton
              icon={button.icon}
              title={button.text}
              suffix={button.suffix}
              ennuizel={button.ennuizel !== undefined}
              key={ii}
              onClick={(e) => onDownloadClick(button, e)}
            />))}
          </div>
        </Section>))}
      </Section>
    </Fragment>
  )
}
