import clsx from 'clsx';
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { deleteRecording } from '../api';
import ModalButton from './modalButton';
import ModalContent from './modalContent';

interface DeleteModalContentProps {
  setModalClose(allowClose: boolean): any;
  deleteKey?: string;
}

export default function DeleteModalContent({ deleteKey: defaultDeleteKey, setModalClose }: DeleteModalContentProps) {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>(null);
  const [deleteKey, setDeleteKey] = useState(defaultDeleteKey || '');

  async function deleteClick() {
    if (isLoading) return;

    if (!deleteKey) {
      setError('Please provide a delete key.');
      return;
    }

    try {
      setModalClose(false);
      setError(null);
      setLoading(true);
      const query = new URLSearchParams(location.search);
      await deleteRecording(this.state.recordingId, query.get('key'), deleteKey);
      location.reload();
    } catch (e) {
      console.error('Failed to delete recording:', e);
      let errorText = e.toString();
      if (e instanceof Response) {
        const body = await e.json().catch(() => {});
        if (body && body.error) errorText = body.error;
        else errorText = `${e.status}: ${e.statusText}`;
      }
      setError(errorText);
      setLoading(false);
      setModalClose(true);
    }
  }

  return (
    <ModalContent
      title="Delete recording?"
      buttons={[
        <ModalButton type="danger" onClick={deleteClick} disabled={isLoading}>Delete</ModalButton>,
        <ModalButton onClick={() => this.closeModal()} disabled={isLoading}>Cancel</ModalButton>,
        error ? <span class="text-red-500">{error}</span> : ''
      ]}
    >
      <p>Are you sure you want to delete this recording? This action is IRREVERSABLE and nobody can help you get it back.</p>
      <div class="flex flex-col mt-6 gap-2">
        <span class="font-display">Enter the delete key here:</span>
        <input
          class={clsx('py-1 px-3 rounded bg-zinc-800 font-mono outline-none focus:ring-2', {
            'focus:ring-zinc-400': !error,
            'focus:ring-red-300 text-red-500': !!error
          })}
          placeholder="123456789"
          onChange={(e) => setDeleteKey(e.currentTarget.value)}
        />
      </div>
    </ModalContent>
  )
}
