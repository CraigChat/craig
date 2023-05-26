import { h } from 'preact';
import { Tooltip } from 'react-tippy';

interface DiscordElementProps {
  id?: string;
  elementType?: 'channel';
  type?: number;
  avatar?: string;
  icon?: string;
  name?: string;
  username?: string;
  discriminator?: string;
  discrim?: string;
}

export default function DiscordElement({ id, avatar, icon, name, username, discriminator, discrim, elementType, type }: DiscordElementProps) {
  const image = avatar || icon;
  const elementDiscrim = discriminator || discrim;
  let elementIcon;

  // Voice Channel Icon
  if (elementType === 'channel' && type === 2)
    elementIcon = (
      <svg viewBox="0 0 13 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M6.25533 0.0505271C6.006 -0.0521396 5.71933 0.00452707 5.52867 0.195194L2.66667 3.33253H0.666667C0.3 3.33253 0 3.63319 0 3.99919V7.99917C0 8.36583 0.3 8.66583 0.666667 8.66583H2.66667L5.52867 11.8045C5.71933 11.9952 6.006 12.0525 6.25533 11.9492C6.50467 11.8458 6.66667 11.6025 6.66667 11.3325V0.66586C6.66667 0.397194 6.50467 0.152527 6.25533 0.0505271ZM8 1.33247V2.6658C9.838 2.6658 11.3333 4.1618 11.3333 5.99917C11.3333 7.83717 9.838 9.3325 8 9.3325V10.6658C10.5733 10.6658 12.6667 8.57317 12.6667 5.99917C12.6667 3.42647 10.5733 1.33247 8 1.33247ZM8 3.99913C9.10267 3.99913 10 4.89717 10 5.99917C10 7.1025 9.10267 7.99917 8 7.99917V6.66583C8.36733 6.66583 8.66667 6.3665 8.66667 5.99917C8.66667 5.63183 8.36733 5.3325 8 5.3325V3.99913Z"
          fill="currentColor"
        />
      </svg>
    );
  // Stage Channel Icon
  else if (elementType === 'channel' && type === 13)
    elementIcon = (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M14 13C14 14.1 13.1 15 12 15C10.9 15 10 14.1 10 13C10 11.9 10.9 11 12 11C13.1 11 14 11.9 14 13ZM8.5 20V19.5C8.5 17.8 9.94 16.5 12 16.5C14.06 16.5 15.5 17.8 15.5 19.5V20H8.5ZM7 13C7 10.24 9.24 8 12 8C14.76 8 17 10.24 17 13C17 13.91 16.74 14.75 16.31 15.49L17.62 16.25C18.17 15.29 18.5 14.19 18.5 13C18.5 9.42 15.58 6.5 12 6.5C8.42 6.5 5.5 9.42 5.5 13C5.5 14.18 5.82 15.29 6.38 16.25L7.69 15.49C7.26 14.75 7 13.91 7 13ZM2.5 13C2.5 7.75 6.75 3.5 12 3.5C17.25 3.5 21.5 7.75 21.5 13C21.5 14.73 21.03 16.35 20.22 17.75L21.51 18.5C22.45 16.88 23 15 23 13C23 6.93 18.07 2 12 2C5.93 2 1 6.93 1 13C1 15 1.55 16.88 2.48 18.49L3.77 17.74C2.97 16.35 2.5 14.73 2.5 13Z"
          fill="currentColor"
        />
      </svg>
    );
  // Regular Icon
  else if (image) elementIcon = <img crossOrigin="anonymous" src={image} class="w-6 h-6 rounded-full" />;

  return (
    <div class="inline-flex flex-row items-center gap-1 justify-center">
      {elementIcon ? (
        <Tooltip disabled={!id} title={id} interactive>
          {elementIcon}
        </Tooltip>
      ) : (
        ''
      )}
      <span>
        {username || name}
        {elementDiscrim && elementDiscrim !== '0' ? <span class="text-zinc-400">#{elementDiscrim}</span> : ''}
      </span>
    </div>
  );
}
