import { h } from 'preact';

interface DiscordElementProps {
  elementType?: 'channel';
  type?: number;
  avatar?: string;
  icon?: string;
  name?: string;
  username?: string;
  discriminator?: string;
}

export default function DiscordElement({ avatar, icon, name, username, discriminator, elementType, type }: DiscordElementProps) {
  const image = avatar || icon;
  let elementIcon;

  // Voice Channel Icon
  if (elementType === 'channel' && type === 1)
    elementIcon = (
      <svg viewBox="0 0 13 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M6.25533 0.0505271C6.006 -0.0521396 5.71933 0.00452707 5.52867 0.195194L2.66667 3.33253H0.666667C0.3 3.33253 0 3.63319 0 3.99919V7.99917C0 8.36583 0.3 8.66583 0.666667 8.66583H2.66667L5.52867 11.8045C5.71933 11.9952 6.006 12.0525 6.25533 11.9492C6.50467 11.8458 6.66667 11.6025 6.66667 11.3325V0.66586C6.66667 0.397194 6.50467 0.152527 6.25533 0.0505271ZM8 1.33247V2.6658C9.838 2.6658 11.3333 4.1618 11.3333 5.99917C11.3333 7.83717 9.838 9.3325 8 9.3325V10.6658C10.5733 10.6658 12.6667 8.57317 12.6667 5.99917C12.6667 3.42647 10.5733 1.33247 8 1.33247ZM8 3.99913C9.10267 3.99913 10 4.89717 10 5.99917C10 7.1025 9.10267 7.99917 8 7.99917V6.66583C8.36733 6.66583 8.66667 6.3665 8.66667 5.99917C8.66667 5.63183 8.36733 5.3325 8 5.3325V3.99913Z" fill="#E4E4E7"/>
      </svg>
    )
  // Regular Icon
  else if (image) elementIcon = <img src={image} class="w-6 h-6 rounded-full" />;

  return (
    <div class="inline-flex flex-row items-center gap-1 justify-center">
      {elementIcon || ''}
      <span>{username || name}{discriminator ? <span class="text-zinc-400">#{discriminator}</span> : ''}</span>
    </div>
  )
}
