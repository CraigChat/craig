import { Fragment, h } from 'preact';
import { RecordingInfo, RecordingUser } from '../api';
import DiscordElement from './discordElement';

interface RecordingProps {
  recording: RecordingInfo;
  recordingId: string | number;
  users: RecordingUser[];
  onDurationClick?(e: MouseEvent): any;
}

export default function Recording({ recording, recordingId, users, onDurationClick }: RecordingProps) {
  return (
    <Fragment>
      <div class="flex flex-col gap-4 bg-zinc-700 shadow-md p-4 rounded-lg text-md text-zinc-200">
        <div>
          <span class="text-zinc-100 font-display">Recording ID:</span>{' '}
          <span class="font-mono">{recordingId}</span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-zinc-100 font-display">Requested By:</span>
            {recording.requesterExtra ? <DiscordElement {...recording.requesterExtra} /> : recording.requester}
            {recording.user ? (
              <Fragment>
                <span class="text-zinc-400 font-medium">on behalf of</span>
                {recording.userExtra ? <DiscordElement {...recording.userExtra} /> : recording.user}
              </Fragment>
            ) : ''}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-zinc-100 font-display">Server:</span>
            {recording.guildExtra ? <DiscordElement {...recording.guildExtra} /> : recording.guild}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-zinc-100 font-display">Channel:</span>
            {recording.channelExtra ? <DiscordElement {...recording.channelExtra} elementType="channel" /> : recording.channel}
          </div>
          <div>
            <span class="text-zinc-100 font-display">Started At:</span>{' '}
            {new Date(recording.startTime).toLocaleString()}
          </div>
        </div>
      </div>
    </Fragment>
  )
}
