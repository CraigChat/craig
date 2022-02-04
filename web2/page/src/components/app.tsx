import { Component, h } from 'preact';
import { Icon } from '@iconify/react';
import closeIcon from '@iconify-icons/ic/close';
import showIcon from '@iconify-icons/bi/eye-fill';
import hideIcon from '@iconify-icons/bi/eye-slash-fill';
import { Translation } from 'react-i18next';
import {
  cookAvatars,
  CookAvatarsPayload,
  getRecording,
  getRecordingDuration,
  getRecordingUsers,
  isReady,
  RecordingInfo,
  RecordingUser
} from '../api';
import { asT, cookDownload, downloadResponse, getPlatformInfo, parseError, PlatformInfo, wait } from '../util';
import { SectionButton } from '../sections';
import i18n, { languages } from '../i18n';
import Recording from './recording';
import Modal from './modal';
import ModalContent from './modalContent';
import ModalButton from './modalButton';
import DeleteModalContent from './deleteModalContent';
import Dropdown from './dropdown';
import EnnuizelModalContent from './ennuizelModalContent';

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

    const localSHP = localStorage.getItem('showHiddenPlatforms');
    this.state.platform.showHidden = localSHP ? JSON.parse(localSHP) : false;

    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.loadDuration = this.loadDuration.bind(this);
    this.startDownload = this.startDownload.bind(this);
    this.startAvatarDownload = this.startAvatarDownload.bind(this);
    this.showDeletePrompt = this.showDeletePrompt.bind(this);
    this.toggleHiddenPlatform = this.toggleHiddenPlatform.bind(this);

    console.log('Loaded', {
      platform: this.state.platform,
      revision: process.env.GIT_REVISION,
      ennuizelHost: process.env.ENNUIZEL_BASE,
      version: process.env.VERSION
    });
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
      const { errorT } = await parseError(e);
      console.error('Failed to get recording:', e);
      this.setState({ error: errorT, loading: false });
    }
  }

  async loadDuration() {
    try {
      this.setState({ durationLoading: true });
      const duration = await getRecordingDuration(this.state.recordingId, this.state.recording.key);
      console.debug('Got duration', duration);
      this.setState({ duration, durationLoading: false });
    } catch (e) {
      const { errorT } = await parseError(e);
      console.error('Failed to get duration:', e);
      this.setState({
        modalOpen: true,
        modalContent: (
          <ModalContent
            title={i18n.t('modal.error')}
            buttons={[
              <ModalButton key={1} onClick={() => this.closeModal()}>
                {i18n.t('close')}
              </ModalButton>
            ]}
          >
            <p>{i18n.t('modal_content.duration_fail')}</p>
            <p>{errorT}</p>
          </ModalContent>
        ),
        modalContentLabel: i18n.t('modal.general'),
        durationLoading: false
      });
    }
  }

  async waitTillReady(key: string) {
    let ready = false;
    let firstRun = true;

    while (!ready) {
      if (firstRun) firstRun = false;
      else await wait(1000);

      ready = await isReady(this.state.recordingId, key);
    }
  }

  async startDownload(button: SectionButton, e: MouseEvent) {
    (e.target as HTMLButtonElement).blur();
    console.log('Downloading...', button);

    const query = new URLSearchParams(location.search);
    if (button.format === 'raw') {
      location.href = `/api/recording/${this.state.recordingId}/raw?key=${query.get('key')}`;
      return;
    }
    if (button.format === 'txt') {
      location.href = `/api/recording/${this.state.recordingId}/.txt?key=${query.get('key')}`;
      return;
    }

    if (button.ennuizel !== undefined) {
      if (localStorage.getItem('disableEnnuizelWarn') !== 'true') {
        this.openModal(
          <EnnuizelModalContent
            platform={this.state.platform}
            onClose={() => this.closeModal()}
            onConfirm={() =>
              (location.href = `${process.env.ENNUIZEL_BASE}?i=${this.state.recordingId}&k=${query.get('key')}&w=${
                button.ennuizel
              }&a=${location.host}`)
            }
          />,
          {
            allowClose: true,
            contentLabel: i18n.t('modal.ennuizel')
          }
        );
      } else {
        location.href = `${process.env.ENNUIZEL_BASE}?i=${this.state.recordingId}&k=${query.get('key')}&w=${
          button.ennuizel
        }&a=${location.host}`;
      }
      return;
    }

    this.openModal(
      <ModalContent title={i18n.t('downloading')}>
        {i18n.t('modal_content.downloading', { format: asT(i18n.t, button.text) })}
      </ModalContent>,
      {
        allowClose: false,
        contentLabel: i18n.t('downloading')
      }
    );

    try {
      await this.waitTillReady(query.get('key'));
      cookDownload(this.state.recordingId, query.get('key'), {
        format: button.format || 'flac',
        container: button.container || 'zip',
        dynaudnorm: button.dynaudnorm || false
      });
      await this.waitTillReady(query.get('key'));
      this.closeModal(true);
    } catch (err) {
      const { errorT } = await parseError(err);
      console.error('Failed to download:', button, err);
      this.openModal(
        <ModalContent
          title={i18n.t('modal.error')}
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              {i18n.t('close')}
            </ModalButton>
          ]}
        >
          <p>{i18n.t('modal_content.download_fail', { format: asT(i18n.t, button.text) })}</p>
          <p>{errorT}</p>
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: i18n.t('modal.error')
        }
      );
    }
  }

  async startAvatarDownload(payload: CookAvatarsPayload, e: MouseEvent) {
    (e.target as HTMLButtonElement).blur();
    console.log('Downloading...', payload);

    this.openModal(
      <ModalContent title={i18n.t('downloading')}>{i18n.t('modal_content.downloading_avatar')}</ModalContent>,
      {
        allowClose: false,
        contentLabel: i18n.t('downloading')
      }
    );

    try {
      const query = new URLSearchParams(location.search);
      const response = await cookAvatars(this.state.recordingId, query.get('key'), payload);

      await downloadResponse(response);
      this.closeModal(true);
    } catch (err) {
      const { errorT } = await parseError(err);
      console.error('Failed to download:', payload, err);
      this.openModal(
        <ModalContent
          title={i18n.t('modal.error')}
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              {i18n.t('close')}
            </ModalButton>
          ]}
        >
          <p>{i18n.t('modal_content.downloading_avatar_fail')}</p>
          <p>{errorT}</p>
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: i18n.t('modal.error')
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
        contentLabel: i18n.t('modal.delete_rec')
      }
    );
  }

  toggleHiddenPlatform() {
    const newPlatform = Object.assign({}, this.state.platform);
    newPlatform.showHidden = !this.state.platform.showHidden;
    this.setState({ platform: newPlatform });
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
      <Translation>
        {(t, { i18n }) => (
          <div class="min-h-screen bg-zinc-900 text-white font-body">
            <div class="sm:max-w-4xl mx-auto py-12 sm:px-12 px-4 space-y-10">
              {/* Header */}
              <div class="flex flex-row items-center justify-center gap-4">
                <img src="/craig.png" class="w-16 h-16 rounded-full" />
                <div class="flex flex-col">
                  <h1 class="sm:text-4xl text-2xl text-zinc-100 font-display">{t('craig_rec')}</h1>
                  <a
                    href="https://craig.chat/"
                    class="text-zinc-400 font-medium hover:underline focus:underline outline-none"
                  >
                    craig.chat →
                  </a>
                </div>
              </div>

              {this.state.loading ? (
                <h2 class="text-2xl text-zinc-100 font-display text-center">{t('loading')}</h2>
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
                  onAvatarsClick={this.startAvatarDownload}
                  onDeleteClick={this.showDeletePrompt}
                />
              )}

              {/* Footer */}
              <div class="flex justify-between">
                <div class="flex flex-col">
                  {hasRev ? (
                    <span class="opacity-50 text-xs">
                      {t('footer.build')} {process.env.GIT_REVISION.slice(0, 7)}
                    </span>
                  ) : (
                    ''
                  )}
                  <div class="flex text-xs gap-1 items-center">
                    <button
                      class="cursor-pointer opacity-50 hover:opacity-75 focus:opacity-100 transition-opacity focus:outline-none"
                      onClick={this.toggleHiddenPlatform}
                    >
                      <Icon icon={this.state.platform.showHidden ? hideIcon : showIcon} />
                    </button>
                    <span class="opacity-50">
                      {[
                        this.state.platform.windows ? 'Windows' : '',
                        this.state.platform.macosx ? 'Mac OS X' : '',
                        this.state.platform.android ? 'Android' : '',
                        this.state.platform.iphone ? 'iPhone' : '',
                        this.state.platform.unix ? 'Unix' : ''
                      ]
                        .filter((p) => !!p)
                        .join(', ')}
                      {this.state.platform.showHidden ? ` ${t('footer.showing_hidden')}` : ''}
                    </span>
                  </div>
                </div>
                <div class="flex flex-col flex-none">
                  {languages.length > 1 ? (
                    <Dropdown
                      right
                      bottom
                      items={languages}
                      selected={languages.find((l) => l.value === i18n.language)}
                      onSelect={(lang) => i18n.changeLanguage(lang.value)}
                    />
                  ) : (
                    ''
                  )}
                </div>
              </div>
            </div>
            <Modal open={this.state.modalOpen} label={this.state.modalContentLabel} onClose={this.closeModal}>
              {this.state.modalContent}
            </Modal>
          </div>
        )}
      </Translation>
    );
  }
}
