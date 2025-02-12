import { Icon } from '@iconify/react';
import showIcon from '@iconify-icons/bi/eye-fill';
import hideIcon from '@iconify-icons/bi/eye-slash-fill';
import closeIcon from '@iconify-icons/ic/close';
import { Component, h } from 'preact';
import { Translation } from 'react-i18next';

import {
  CookAvatarsPayload,
  cookDownload,
  getRecording,
  getRecordingDuration,
  getRecordingUsers,
  isReady,
  ReadyState,
  RecordingInfo,
  RecordingUser
} from '../api';
import i18n, { languages } from '../i18n';
import { SectionButton } from '../sections';
import { asT, getPlatformInfo, parseError, PlatformInfo, wait } from '../util';
import DeleteModalContent from './deleteModalContent';
import DownloadingModalContent from './downloadingModalContent';
import Dropdown from './dropdown';
import EnnuizelModalContent from './ennuizelModalContent';
import Modal from './modal';
import ModalButton from './modalButton';
import ModalButtonDownloadLink from './modalButtonDownloadLink';
import ModalContent from './modalContent';
import Recording from './recording';

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

  downloading: boolean;
  readyState: ReadyState | null;
  downloadingAvatars: boolean;
  dlButton: SectionButton | null;
  showPreviousDownload: boolean;

  modalOpen: boolean;
  allowModalClose: boolean;
  modalContentLabel: string;
  modalContent: any;
}

export default class App extends Component<any, AppState> {
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
      error: null,

      downloading: false,
      readyState: null,
      downloadingAvatars: false,
      dlButton: null,
      showPreviousDownload: true
    };

    const localSHP = localStorage.getItem('showHiddenPlatforms');
    this.state.platform.showHidden = localSHP ? JSON.parse(localSHP) : false;

    this.onBeforeUnload = this.onBeforeUnload.bind(this);
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.loadDuration = this.loadDuration.bind(this);
    this.startDownload = this.startDownload.bind(this);
    this.waitTillReady = this.waitTillReady.bind(this);
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

  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.state.downloading) {
      event.returnValue = i18n.t('still_downloading');
      event.preventDefault();
    }
  }

  async componentDidMount() {
    window.addEventListener('beforeunload', this.onBeforeUnload);
    await this.loadRecording();
    const query = new URLSearchParams(location.search);
    const deleteKey = query.get('delete');
    if (this.state.recording && deleteKey) this.showDeletePrompt(null, deleteKey);
  }

  componentWillUnmount() {
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  async loadRecording() {
    try {
      const query = new URLSearchParams(location.search);
      const key = query.get('key');
      const recording = await getRecording(this.state.recordingId, key);
      const users = await getRecordingUsers(this.state.recordingId, key);
      const readyState = await isReady(this.state.recordingId, key);
      console.debug('Got recording', recording, users, readyState);
      this.setState({ recording, users, loading: false, readyState });
      if (readyState && !readyState.ready) await this.updatePreviousReadyState(key);
    } catch (e) {
      const { errorT } = await parseError(e);
      console.error('Failed to get recording:', e);
      this.setState({ error: errorT, loading: false });
    }
  }

  async updatePreviousReadyState(key: string) {
    let ready = false;

    const getReadyState = async () => {
      const readyState = await isReady(this.state.recordingId, key);
      ready = readyState.ready;
      this.setState({ readyState });
      setTimeout(async () => {
        if (ready || !this.state.showPreviousDownload) return;
        await getReadyState();
      }, 1000);
    };

    await getReadyState();
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

    while (!ready) {
      await wait(1000);
      const readyState = await isReady(this.state.recordingId, key);
      ready = readyState.ready;
      this.setState({ readyState, showPreviousDownload: false });
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
              (location.href = `${process.env.ENNUIZEL_BASE}?i=${this.state.recordingId}&k=${query.get('key')}&w=${button.ennuizel.toString(36)}&a=${
                location.host
              }`)
            }
          />,
          {
            allowClose: true,
            contentLabel: i18n.t('modal.ennuizel')
          }
        );
      } else {
        location.href = `${process.env.ENNUIZEL_BASE}?i=${this.state.recordingId}&k=${query.get('key')}&w=${button.ennuizel}&a=${location.host}`;
      }
      return;
    }

    // Check ready state before cooking
    const readyState = await isReady(this.state.recordingId, query.get('key'));
    if (!readyState.ready)
      return this.openModal(
        <ModalContent
          title={i18n.t('modal.error')}
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              {i18n.t('close')}
            </ModalButton>
          ]}
        >
          {i18n.t('error.1006')}
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: i18n.t('modal.error')
        }
      );

    // Download if this format already was cooked
    const payload = {
      format: button.format || 'flac',
      container: button.container || 'zip',
      dynaudnorm: button.dynaudnorm || false
    };
    // if (
    //   readyState.download &&
    //   readyState.download.format === payload.format &&
    //   readyState.download.container === payload.container &&
    //   readyState.download.dynaudnorm === payload.dynaudnorm &&
    //   readyState.download.type === 'default'
    // ) {
    //   location.href = `/dl/${readyState.download.file}`;
    //   this.showCompletedPrompt(`/dl/${readyState.download.file}`, true);
    //   return;
    // }

    this.openDownloadingModal(false, button);

    try {
      await cookDownload(this.state.recordingId, query.get('key'), payload);
      await this.waitTillReady(query.get('key'));

      const file = this.state.readyState.download.file;
      this.showCompletedPrompt(file);
      setTimeout(() => (location.href = `/dl/${file}`), 100);
      this.setState({ downloading: false, readyState: null });
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

    // Check ready state before cooking
    const query = new URLSearchParams(location.search);
    const readyState = await isReady(this.state.recordingId, query.get('key'));
    if (!readyState.ready)
      return this.openModal(
        <ModalContent
          title={i18n.t('modal.error')}
          buttons={[
            <ModalButton key={1} onClick={() => this.closeModal()}>
              {i18n.t('close')}
            </ModalButton>
          ]}
        >
          {i18n.t('error.1006')}
        </ModalContent>,
        {
          allowClose: true,
          contentLabel: i18n.t('modal.error')
        }
      );

    this.openDownloadingModal(true);
    if (
      readyState.download &&
      readyState.download.format === payload.format &&
      readyState.download.container === payload.container &&
      readyState.download.dynaudnorm === false &&
      readyState.download.type === 'avatars'
    ) {
      location.href = `/dl/${readyState.download.file}`;
      this.showCompletedPrompt(`/dl/${readyState.download.file}`, true);
      return;
    }

    try {
      await cookDownload(this.state.recordingId, query.get('key'), payload, 'avatars');
      await this.waitTillReady(query.get('key'));

      const file = this.state.readyState.download.file;
      this.showCompletedPrompt(file);
      setTimeout(() => (location.href = `/dl/${file}`), 100);
      this.setState({ downloading: false, readyState: null });
    } catch (err) {
      const { errorT } = await parseError(err);
      console.error('Failed to download avatars:', payload, err);
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

  showCompletedPrompt(file: string, alreadyFinished = false) {
    this.openModal(
      <ModalContent
        title={i18n.t('modal.download_done')}
        buttons={[
          <ModalButtonDownloadLink key={1} type="brand" file={file} href={`/dl/${file}`}>
            {i18n.t('modal_content.download')}
          </ModalButtonDownloadLink>,
          <ModalButton key={2} onClick={() => this.closeModal()}>
            {i18n.t('close')}
          </ModalButton>
        ]}
      >
        <p>{i18n.t(alreadyFinished ? 'modal_content.download_already_done' : 'modal_content.download_done')}</p>
      </ModalContent>,
      {
        allowClose: true,
        contentLabel: i18n.t('modal.download_done')
      }
    );
  }

  showDeletePrompt(e?: MouseEvent, deleteKey?: string) {
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

  openDownloadingModal(avatars = false, button?: SectionButton) {
    this.setState({
      modalOpen: true,
      allowModalClose: false,
      modalContentLabel: i18n.t('downloading'),
      modalContent: null,
      downloading: true,
      downloadingAvatars: avatars,
      dlButton: button || null
    });
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
    if (this.state.allowModalClose || force) this.setState({ modalOpen: false, modalContent: null, downloading: false });
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
                  <a href="https://craig.chat/" class="text-zinc-400 font-medium hover:underline focus:underline outline-none">
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
                    <span class="opacity-50 text-xs font-mono">
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
                      onSelect={(lang) => {
                        localStorage.setItem('i18nextLng', lang.value);
                        i18n.changeLanguage(lang.value);
                      }}
                    />
                  ) : (
                    ''
                  )}
                </div>
              </div>
            </div>
            <Modal open={this.state.modalOpen} label={this.state.modalContentLabel} onClose={() => this.closeModal()}>
              {this.state.downloading ? (
                <DownloadingModalContent
                  readyState={this.state.readyState}
                  avatars={this.state.downloadingAvatars}
                  button={this.state.dlButton}
                  users={this.state.users}
                />
              ) : (
                this.state.modalContent
              )}
            </Modal>
          </div>
        )}
      </Translation>
    );
  }
}
