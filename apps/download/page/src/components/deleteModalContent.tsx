import clsx from 'clsx';
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';

import { deleteRecording } from '../api';
import { parseError } from '../util';
import ModalButton from './modalButton';
import ModalContent from './modalContent';

interface DeleteModalContentProps {
  recordingId: string;
  onClose(): any;
  setModalClose(allowClose: boolean): any;
  deleteKey?: string;
}

export default function DeleteModalContent({ recordingId, deleteKey: defaultDeleteKey, setModalClose, onClose }: DeleteModalContentProps) {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>(null);
  const [deleteKey, setDeleteKey] = useState(defaultDeleteKey || '');
  const { t } = useTranslation();

  async function deleteClick() {
    if (isLoading) return;

    if (!deleteKey) {
      setError(t('error.no_del_key'));
      return;
    }

    try {
      setModalClose(false);
      setError(null);
      setLoading(true);
      const query = new URLSearchParams(location.search);
      await deleteRecording(recordingId, query.get('key'), deleteKey);
      location.reload();
    } catch (e) {
      console.error('Failed to delete recording:', e);
      const { errorT } = await parseError(e);
      setError(errorT);
      setLoading(false);
      setModalClose(true);
    }
  }

  return (
    <ModalContent
      title={t('modal.delete_rec')}
      buttons={[
        <ModalButton key={1} type="danger" onClick={deleteClick} disabled={isLoading}>
          {t('delete')}
        </ModalButton>,
        <ModalButton key={2} onClick={() => onClose()} disabled={isLoading}>
          {t('cancel')}
        </ModalButton>,
        error ? (
          <span key={3} class="text-red-500">
            {error}
          </span>
        ) : (
          ''
        )
      ]}
    >
      <p>{t('modal_content.delete_rec')}</p>
      <div class="flex flex-col mt-6 gap-2">
        <span class="font-display">{t('modal_content.enter_del_key')}</span>
        <input
          value={deleteKey}
          class={clsx('py-1 px-3 rounded bg-zinc-800 font-mono outline-none focus:ring-1', {
            'focus:ring-teal-500': !error,
            'focus:ring-red-300 text-red-500': !!error,
            'bg-opacity-50 cursor-not-allowed': isLoading
          })}
          placeholder="123456789"
          onChange={(e) => setDeleteKey(e.currentTarget.value)}
        />
      </div>
    </ModalContent>
  );
}
