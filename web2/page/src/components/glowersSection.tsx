import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import glowersIcon from '@iconify-icons/ic/round-adjust';
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
    suffix: '(QuickTime Animation, Windows extractor)',
    value: 'movsfx',
    hidden: (p) => !p.windows && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: '(PNG, Windows extractor)',
    value: 'movpngsfx',
    hidden: (p) => !p.windows && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: '(QuickTime Animation, Mac OS X extractor)',
    value: 'movsfxm',
    hidden: (p) => (!p.macosx || p.iphone) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: '(PNG, Mac OS X extractor)',
    value: 'movpngsfxm',
    hidden: (p) => (!p.macosx || p.iphone) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: '(QuickTime Animation, Unix extractor)',
    value: 'movsfxu',
    hidden: (p) => (!p.unix || p.android) && !p.showHidden
  },
  {
    title: 'MOV',
    suffix: '(PNG, Unix extractor)',
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
    <Section title="Glowers" icon={glowersIcon} small>
      <div class="flex flex-col flex-wrap gap-5">
        <div
          class={clsx(
            transparent ? 'border border-black border-opacity-50' : '',
            'flex items-center justify-center rounded-lg p-6 gap-4'
          )}
          style={!transparent ? { 'background-color': bgColor } : ''}
        >
          {users.slice(0, 4).map((user) => (
            <img
              key={user.id}
              class="w-20 h-20 rounded-full border-4"
              src={user.avatar || '/craig.png'}
              style={{ 'border-color': fgColor }}
            />
          ))}
        </div>
        <div class="flex gap-2">
          <ColorPicker label="Background Color" color={bgColor} onChange={setBgColor} full className="flex-grow" />
          <ColorPicker label="Foreground Color" color={fgColor} onChange={setFgColor} full className="flex-grow" />
        </div>
        <Toggle label="Transparent Background" description="TODO" checked={transparent} onToggle={setTransparent} />
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
          title="Download"
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
