import { Component, h } from 'preact';
import { Icon, IconifyIcon } from '@iconify/react';
import ReactModal from 'react-modal';
import clsx from 'clsx';
import { getRecording, getRecordingUsers, RecordingInfo, RecordingUser } from '../api';
import * as icons from '../icons';

export interface ModalOptions {
  contentLabel?: string;
  allowClose?: boolean;
}

export type OpenModalFunction = (content: any, opts?: ModalOptions) => void;

interface AppState {
  loading: boolean;
  recording: RecordingInfo | null;
  users: RecordingUser[] | null;
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
      recording: null,
      users: null,
      duration: null,
      error: null
    };

    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
  }

  async componentDidMount() {
    await this.loadRecording();
  }

  async loadRecording() {
    try {
      const recId = location.pathname.split('/')[2];
      const query = new URLSearchParams(location.search);
      const recording = await getRecording(recId, query.get('key'));
      const users = await getRecordingUsers(recId, query.get('key'));
      console.debug('Got recording', recording, users);
      this.setState({ recording, users, loading: false });
    } catch (e) {
      const response = e as Response;
      const body = response.body ? await response.json() : { error: `${response.status}: ${response.statusText}` };
      console.error('Failed to get recording:', response, body);
      this.setState({ error: body.error, loading: false });
    }
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
    return (
      <div class="min-h-screen font-body text-white bg-zinc-900 flex flex-row justify-center items-stretch">
        <div class="bg-black bg-opacity-25 md:shadow-2xl min-h-screen max-w-screen-md w-full p-8 flex flex-col space-y-8">
          {/* Header */}
          <div class="flex flex-row items-center justify-center gap-4">
            <img src="/assets/craig.png" class="w-16 h-16 rounded-full" />
            <div class="flex flex-col">
              <h1 class="text-4xl text-zinc-100 font-display">Craig Recording</h1>
              <a href="https://craig.chat/" class="text-zinc-400 font-medium hover:underline">
                craig.chat →
              </a>
            </div>
          </div>

          {this.state.loading ?
            <h2 class="text-2xl text-zinc-100 font-display text-center">Loading...</h2> : (
              this.state.error ?
              <div class="flex flex-col items-center justify-center">
                <h2 class="text-2xl text-zinc-100 font-display"><Icon icon={icons.close} className="text-red-500" /> {this.state.error}</h2>
              </div> : <span>TODO</span>
            )}
        </div>
        <ReactModal
          isOpen={this.state.modalOpen}
          onRequestClose={() => this.closeModal()}
          ariaHideApp={false}
          contentLabel={this.state.modalContentLabel}
          portalClassName={clsx('fixed inset-0', { 'pointer-events-none': !this.state.modalOpen })}
          overlayClassName="h-screen flex justify-center items-center bg-black bg-opacity-25"
          className="p-6 bg-zinc-700 text-white outline-none rounded min-w-1/2 w-5/6 md:min-w-2/5"
        >
          {this.state.modalContent}
        </ReactModal>
      </div>
    );
  }
}
