import { Component, h } from 'preact';
import { Icon } from '@iconify/react';
import {
  cookAvatars,
  CookAvatarsPayload,
  cookRecording,
  getRawRecording,
  getRecording,
  getRecordingDuration,
  getRecordingUsers,
  RecordingInfo,
  RecordingUser
} from '../api';
import Recording from './recording';
import Modal from './modal';
import closeIcon from '@iconify-icons/ic/close';
import ModalContent from './modalContent';
import ModalButton from './modalButton';
import { getPlatformInfo, PlatformInfo } from '../util';
import { SectionButton } from '../sections';
import DeleteModalContent from './deleteModalContent';

export interface ModalOptions {
  contentLabel?: string;
  allowClose?: boolean;
}

export type OpenModalFunction = (content: any, opts?: ModalOptions) => void;

interface AppState {
  loading: boolean;
  platform: PlatformInfo;
  recordingId: string;
  recording: RecordingInfo | null;
  users: RecordingUser[] | null;
  durationLoading: boolean;
  duration: number | null;
  error: string | null;

  modalOpen: boolean;
  allowModalClose: boolean;
  modalContentLabel: string;
  modalContent: any;
}

export default class App extends Component<{}, AppState> {
  constructor() {
    super();

    this.state = {
      modalOpen: false,
      allowModalClose: true,
      modalContentLabel: 'Modal',
      modalContent: null,

      loading: true,
      platform: getPlatformInfo(),
      recordingId: location.pathname.split('/')[2],
      recording: null,
      users: null,
      durationLoading: false,
      duration: null,
      error: null
    };

    // TODO show hidden platforms button
    this.state.platform.showHidden = !!localStorage.getItem('showHiddenPlatforms');

    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);

    console.log('Loaded', { platform: this.state.platform });
  }

  async componentDidMount() {
    await this.loadRecording();
    const query = new URLSearchParams(location.search);
    const deleteKey = query.get('delete');
    if (this.state.recording && deleteKey) await this.showDeletePrompt(null, deleteKey);
  }

  async loadRecording() {
    try {
      const query = new URLSearchParams(location.search);
      const recording = await getRecording(this.state.recordingId, query.get('key'));
      const users = await getRecordingUsers(this.state.recordingId, query.get('key'));
      console.debug('Got recording', recording, users);
      this.setState({ recording, users, loading: false });
    } catch (e) {
      const response = e as Response;
      const body = response.body ? await response.json() : { error: `${response.status}: ${response.statusText}` };
      console.error('Failed to get recording:', response, body);
      this.setState({ error: body.error, loading: false });
    }
  }

  async loadDuration() {
    try {
      this.setState({ durationLoading: true });
      const duration = await getRecordingDuration(this.state.recordingId, this.state.recording.key);
      console.debug('Got duration', duration);
      this.setState({ duration, durationLoading: false });
    } catch (e) {
      const response = e as Response;
      const body = response.body
        ? await response.json().catch(() => {})
        : { error: `${response.status}: ${response.statusText}` };
      console.error('Failed to get duration:', response, body);
      this.setState({
        modalOpen: true,
        modalContent: (
          <ModalContent
            title="Uh oh."
            buttons={[
              <ModalButton key={1} onClick={() => this.closeModal()}>
                Close
              </ModalButton>
            ]}
          >
            <p>Failed to get the duration of the recording!</p>
            <p>{body.error}</p>
          </ModalContent>
        ),
        modalContentLabel: 'Failed to get duration',
        durationLoading: false
      });
    }
  }

  async startDownload(button: SectionButton, e: MouseEvent) {
    (e.target as HTMLButtonElement).blur();
    console.log('Downloading...', button);

    if (button.ennuizel !== undefined) {
      // TODO ennuizel prompt & link
      return;
    }

    this.openModal(<ModalContent title="Downloading...">Downloading in the {button.text} format...</ModalContent>, {
      allowClose: false,
      contentLabel: 'Downloading'
    });

    try {
      const query = new URLSearchParams(location.search);
      const response =
        button.format === 'raw'
          ? await getRawRecording(this.state.recordingId, query.get('key'))
          : await cookRecording(this.state.recordingId, query.get('key'), {
              format: button.format || 'flac',
              container: button.container || 'zip',
              dynaudnorm: button.dynaudnorm || false
            });

      const filename = response.headers.get('content-disposition').slice(21);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      console.log('Opened download link', { blob, filename });
      URL.revokeObjectURL(url);
      this.closeModal(true);
    } catch (err) {
      let errText = err.toString();
      if (err instanceof Response) {
        if (err.status <= 499) {
          const body = await err.json().catch(() => {});
          errText = body.error || `${err.status}: ${err.statusText}`;
        }
      }

      console.error('Failed to download:', button, err);
      this.openModal(
        <ModalContent
          title="Download failed!"
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              Close
            </ModalButton>
          ]}
        >
          <p>Failed to download the {button.text} format.</p>
          <p>{errText}</p>
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: 'Download failed'
        }
      );
    }
  }

  async startAvatarDownload(payload: CookAvatarsPayload, e: MouseEvent) {
    (e.target as HTMLButtonElement).blur();
    console.log('Downloading...', payload);

    this.openModal(<ModalContent title="Downloading...">Downloading avatars...</ModalContent>, {
      allowClose: false,
      contentLabel: 'Downloading'
    });

    try {
      const query = new URLSearchParams(location.search);
      const response = await cookAvatars(this.state.recordingId, query.get('key'), payload);

      const filename = response.headers.get('content-disposition').slice(21);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      console.log('Opened download link', { blob, filename });
      URL.revokeObjectURL(url);
      this.closeModal(true);
    } catch (err) {
      let errText = err.toString();
      if (err instanceof Response) {
        if (err.status <= 499) {
          const body = await err.json().catch(() => {});
          errText = body.error || `${err.status}: ${err.statusText}`;
        }
      }

      console.error('Failed to download:', payload, err);
      this.openModal(
        <ModalContent
          title="Download failed!"
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              Close
            </ModalButton>
          ]}
        >
          <p>Failed to download avatars.</p>
          <p>{errText}</p>
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: 'Download failed'
        }
      );
    }
  }

  async showDeletePrompt(e?: MouseEvent, deleteKey?: string) {
    if (e) (e.target as HTMLButtonElement).blur();

    this.openModal(
      <DeleteModalContent
        recordingId={this.state.recordingId}
        onClose={() => this.closeModal(true)}
        deleteKey={deleteKey}
        setModalClose={(allowModalClose) => this.setState({ allowModalClose })}
      />,
      {
        allowClose: true,
        contentLabel: 'Delete recording'
      }
    );
  }

  openModal(content: any, opts: ModalOptions = {}) {
    this.setState({
      modalOpen: true,
      allowModalClose: 'allowClose' in opts ? opts.allowClose : true,
      modalContentLabel: 'contentLabel' in opts ? opts.contentLabel : 'Modal',
      modalContent: content
    });
  }

  closeModal(force = false) {
    if (this.state.allowModalClose || force) this.setState({ modalOpen: false, modalContent: null });
  }

  render() {
    const hasRev = process.env.GIT_REVISION && !process.env.GIT_REVISION.startsWith('<');

    return (
      <div class="min-h-screen bg-zinc-900 text-white font-body">
        <div class="sm:max-w-4xl mx-auto py-12 sm:px-12 px-4 space-y-10">
          {/* Header */}
          <div class="flex flex-row items-center justify-center gap-4">
            <img src="/assets/craig.png" class="w-16 h-16 rounded-full" />
            <div class="flex flex-col">
              <h1 class="sm:text-4xl text-3xl text-zinc-100 font-display">Craig Recording</h1>
              <a
                href="https://craig.chat/"
                class="text-zinc-400 font-medium hover:underline focus:underline outline-none"
              >
                craig.chat →
              </a>
            </div>
          </div>

          {this.state.loading ? (
            <h2 class="text-2xl text-zinc-100 font-display text-center">Loading...</h2>
          ) : this.state.error ? (
            <h2 class="flex items-center gap-2 justify-center text-2xl text-zinc-100 font-display">
              <Icon icon={closeIcon} className="text-red-500 text-3xl" />
              <span>{this.state.error}</span>
            </h2>
          ) : (
            <Recording
              state={this.state}
              onDurationClick={this.loadDuration}
              onDownloadClick={this.startDownload}
              onDeleteClick={this.showDeletePrompt}
            />
          )}

          {/* Debug */}
          <div class="flex flex-col">
            {hasRev ? <span class="opacity-50 text-xs">Build {process.env.GIT_REVISION.slice(0, 7)}</span> : ''}
            <span class="opacity-50 text-xs">
              {[
                this.state.platform.windows ? 'Windows' : '',
                this.state.platform.macosx ? 'Mac OS X' : '',
                this.state.platform.android ? 'Android' : '',
                this.state.platform.iphone ? 'iPhone' : '',
                this.state.platform.unix ? 'Unix' : ''
              ]
                .filter((p) => !!p)
                .join(', ')}
              {this.state.platform.showHidden ? ' (showing hidden)' : ''}
            </span>
          </div>
        </div>
        <Modal open={this.state.modalOpen} label={this.state.modalContentLabel} onClose={() => this.closeModal()}>
          {this.state.modalContent}
        </Modal>
      </div>
    );
  }
}
