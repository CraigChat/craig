import { h } from 'preact';
import { useTranslation } from 'react-i18next';
import { PlatformInfo } from '../util';
import ModalButton from './modalButton';
import ModalContent from './modalContent';

interface EnnuizelModalContentProps {
  platform: PlatformInfo;
  onClose(): any;
  onConfirm(): any;
}

export default function EnnuizelModalContent({ platform, onConfirm, onClose }: EnnuizelModalContentProps) {
  const { t } = useTranslation();

  async function ezClick(disableWarn = false) {
    if (disableWarn) localStorage.setItem('disableEnnuizelWarn', 'true');
    onConfirm();
  }

  return (
    <ModalContent
      title={t('modal.ennuizel')}
      buttons={[
        <ModalButton key={1} type="danger" onClick={() => ezClick()}>
          {t('modal_content.ennuizel_confirm')}
        </ModalButton>,
        <ModalButton key={2} onClick={() => onClose()}>
          {t('cancel')}
        </ModalButton>,
        <ModalButton key={3} type="transparent" onClick={() => ezClick(true)}>
          {t('modal_content.ennuizel_dont_show')}
        </ModalButton>
      ]}
    >
      <p>{t('modal_content.ennuizel')}</p>
      {platform.android || platform.iphone ? (
        <div class="flex flex-col mt-6 p-2 border-2 bg-opacity-25 rounded-md border-red-500 bg-red-500">
          {t('modal_content.ennuizel_mobile')}
        </div>
      ) : (
        ''
      )}
    </ModalContent>
  );
}
