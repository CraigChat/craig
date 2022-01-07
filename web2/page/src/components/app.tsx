import { Component, h } from 'preact';
import ReactModal from 'react-modal';
import clsx from 'clsx';

export interface ModalOptions {
  contentLabel?: string;
  allowClose?: boolean;
}

export type OpenModalFunction = (content: any, opts?: ModalOptions) => void;

interface AppState {
  loading: boolean;

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

      loading: true
    };

    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
  }

  async componentDidMount() {
    await this.loadRecording();
  }

  async loadRecording() {
    // try {
    //   const rewards = await getRewards();
    //   logger.log('Got rewards', rewards);
    //   this.setState({ rewards, rewardsError: null, loading: false });
    // } catch (e) {
    //   logger.error('Failed to get rewards:', e);
    //   this.setState({ rewardsError: e, loading: false });
    // }
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
      <div class="min-h-screen font-body text-white bg-gray-900 flex flex-row justify-center items-stretch">
        <div
          class={`bg-black bg-opacity-25 md:shadow-2xl min-h-screen max-w-screen-md w-full p-8 flex flex-col space-y-8 ${
            this.state.loading ? 'h-screen overflow-hidden' : ''
          }`}
        >
          <span>TODO</span>
        </div>
        <ReactModal
          isOpen={this.state.modalOpen}
          onRequestClose={() => this.closeModal()}
          ariaHideApp={false}
          contentLabel={this.state.modalContentLabel}
          portalClassName={clsx('fixed inset-0', { 'pointer-events-none': !this.state.modalOpen })}
          overlayClassName="h-screen flex justify-center items-center bg-black bg-opacity-25"
          className="p-6 bg-gray-700 text-white outline-none rounded min-w-1/2 w-5/6 md:min-w-2/5"
        >
          {this.state.modalContent}
        </ReactModal>
      </div>
    );
  }
}
