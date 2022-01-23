import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import glowersIcon from '@iconify-icons/ic/round-adjust';
import videoIcon from '@iconify-icons/ic/round-video-file';
import { useTranslation } from 'react-i18next';
import Section from './section';
import { asT, PlatformInfo, StringT } from '../util';
import Dropdown from './dropdown';
import { CookAvatarsPayload, RecordingUser } from '../api';
import Toggle from './toggle';
import ColorPicker from './colorPicker';
import DownloadButton from './downloadButton';
import clsx from 'clsx';

interface GlowersSectionProps {
  users: RecordingUser[];
  platform: PlatformInfo;
  onDownload?(payload: CookAvatarsPayload, e: MouseEvent): any;
}

interface DropdownItem {
  title: StringT;
  suffix?: StringT;
  value: string;
  hidden?: (p: PlatformInfo) => boolean;
}

interface DropdownItemString {
  title: string;
  suffix?: string;
  value: string;
}

const items: DropdownItem[] = [
  {
    title: 'MOV',
    suffix: (t) => t('download.movsfx'),
    value: 'movsfx',
    hidden: (p) => !p.windows && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: (t) => t('download.movpngsfx'),
    value: 'movpngsfx',
    hidden: (p) => !p.windows && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: (t) => t('download.movsfxm'),
    value: 'movsfxm',
    hidden: (p) => (!p.macosx || p.iphone) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: (t) => t('download.movpngsfxm'),
    value: 'movpngsfxm',
    hidden: (p) => (!p.macosx || p.iphone) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: (t) => t('download.movsfxu'),
    value: 'movsfxu',
    hidden: (p) => (!p.unix || p.android) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: (t) => t('download.movpngsfxu'),
    value: 'movpngsfxu',
    hidden: (p) => (!p.unix || p.android) && !p.showHidden
  },
  {
    title: 'MKV',
    suffix: '(MPEG-4)',
    value: 'mkvh264'
  },
  {
    title: 'WebM',
    suffix: '(VP8)',
    value: 'webmvp8'
  }
];

export default function GlowersSection({ users, platform, onDownload }: GlowersSectionProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<DropdownItemString[]>([]);
  const [formatOption, setFormatOption] = useState(options[0]);
  const [bgColor, setBgColor] = useState('#000000');
  const [fgColor, setFgColor] = useState('#008000');
  const [transparent, setTransparent] = useState(false);

  useEffect(() => {
    const newOptions = items
      .filter((item) => !item.hidden || !item.hidden(platform))
      .map(
        (item) =>
          ({
            title: asT(t, item.title),
            ...(item.suffix ? { suffix: asT(t, item.suffix) } : ''),
            value: item.value
          } as DropdownItemString)
      );
    setOptions(newOptions);
    setFormatOption(newOptions[0]);
  }, [platform, t]);

  return (
    <Section title={t('glowers.title')} icon={glowersIcon} small>
      <div class="flex flex-col flex-wrap gap-5">
        <div
          class={clsx(
            'border-2 border-dashed',
            transparent ? 'border-white border-opacity-50' : 'border-transparent',
            'flex items-center justify-center rounded-lg p-6 gap-4 overflow-hidden'
          )}
          style={!transparent ? { 'background-color': bgColor } : ''}
        >
          {users.slice(0, 4).map((user, i) => (
            <div key={user.id} class="w-20 h-20 rounded-full overflow-hidden relative">
              <i
                class="absolute w-full h-full top-0 animate-pulse"
                style={{
                  backgroundColor: fgColor,
                  animationDelay: `${i / 2}s`
                }}
              />
              <img class="absolute w-18 h-18 top-1 left-1 rounded-full bg-black" src={user.avatar || '/craig.png'} />
            </div>
          ))}
        </div>
        <div class="flex gap-2 flex-col sm:flex-row">
          <ColorPicker
            label={t('glowers.bg_color')}
            color={bgColor}
            onChange={setBgColor}
            full
            className="flex-grow"
            disabled={transparent}
          />
          <ColorPicker label={t('glowers.fg_color')} color={fgColor} onChange={setFgColor} full className="flex-grow" />
        </div>
        <Toggle
          label={t('glowers.transparent_bg')}
          description={t([
            `glowers.format_desc.${formatOption ? formatOption.value : 'mov'}`,
            'glowers.format_desc.mov'
          ])}
          checked={transparent}
          onToggle={setTransparent}
        />
        {formatOption && ( // Only render after useEffect goes off
          <Dropdown
            items={options}
            label="Format"
            className="w-full sm:w-2/3"
            full
            selected={formatOption}
            onSelect={setFormatOption}
          />
        )}
        <DownloadButton
          icon={videoIcon}
          title={t('glowers.download')}
          suffix={formatOption && ['movsfx', 'movpngsfx'].includes(formatOption.value) ? '(.exe)' : '(.zip)'}
          onClick={(e) =>
            onDownload &&
            onDownload(
              {
                format: formatOption.value,
                bg: bgColor.slice(1),
                fg: fgColor.slice(1),
                transparent
              },
              e
            )
          }
        />
      </div>
    </Section>
  );
}
