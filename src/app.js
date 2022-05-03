import Vue from 'vue';
import AudioRecorderView from './views/AudioRecorder.vue';
import VUMeter from './views/VUMeter.vue';
import Timer from './views/Timer.vue';
import Recorder from 'components/Recorder';
import State from 'components/State';
import Util from 'components/Util';

const AUDIO_SRC_NOT_SPECIFIED = '';
const DEFAULT_DESCRIPTION = 'Audio Recorder';

export default class {

  /**
   * @typedef {Object} Parameters
   *
   * @property {string} title Title
   * @property {Object} l10n Translations
   * @property {string} l10n.download Download button text
   * @property {string} l10n.retry Retry button text
   * @property {string} l10n.finishedRecording Done recording audio
   * @property {string} l10n.microphoneInaccessible Microphone blocked
   * @property {string} l10n.downloadRecording Download recording message
   */

  /**
   * @constructor
   *
   * @param {Parameters} params Content type parameters
   * @param {string} contentId
   * @param {object} contentData
   */
  constructor(params, contentId, contentData = {}) {
    this.params = Util.extend({
      l10n: {
        recordAnswer: 'Record',
        pause: 'Pause',
        continue: 'Continue',
        download: 'Download',
        done: 'Done',
        retry: 'Retry',
        microphoneNotSupported: 'Microphone not supported. Make sure you are using a browser that allows microphone recording.',
        microphoneInaccessible: 'Microphone is not accessible. Make sure that the browser microphone is enabled.',
        insecureNotAllowed: 'Access to microphone is not allowed in your browser since this page is not served using HTTPS. Please contact the author, and ask him to make this available using HTTPS',
        statusReadyToRecord: 'Press a button below to record your answer.',
        statusRecording: 'Recording...',
        statusPaused: 'Recording paused. Press a button to continue recording.',
        statusFinishedRecording: 'You have successfully recorded your answer! Listen to the recording below.',
        downloadRecording: 'Download this recording or retry.',
        retryDialogHeaderText: 'Retry recording?',
        retryDialogBodyText: 'By pressing "Retry" you will lose your current recording.',
        retryDialogConfirmText: 'Retry',
        retryDialogCancelText: 'Cancel',
        statusCantCreateTheAudioFile: 'Can\'t create the audio file.',
        statusResume: 'Your recording has already been uploaded.',
      }
    }, params);

    this.contentData = contentData;

    this.viewState = this.contentData && this.contentData.previousState && this.contentData.previousState.viewState ?
      this.contentData.previousState.viewState :
      State.READY;

    const rootElement = document.createElement('div');
    rootElement.classList.add('h5p-audio-recorder');

    const recorder = this.recorder = new Recorder();

    // Emit file to platform
    recorder.on('fileReady', (event) => {
      this.triggerFileExport(event.data);
    });

    const statusMessages = {};
    statusMessages[State.UNSUPPORTED] = this.params.l10n.microphoneNotSupported;
    statusMessages[State.BLOCKED] = this.params.l10n.microphoneInaccessible;
    statusMessages[State.READY] = this.params.l10n.statusReadyToRecord;
    statusMessages[State.RECORDING] = this.params.l10n.statusRecording;
    statusMessages[State.PAUSED] = this.params.l10n.statusPaused;
    statusMessages[State.DONE] = this.params.l10n.statusFinishedRecording;
    statusMessages[State.INSECURE_NOT_ALLOWED] = this.params.l10n.insecureNotAllowed;
    statusMessages[State.CANT_CREATE_AUDIO_FILE] = this.params.l10n.statusCantCreateTheAudioFile;
    statusMessages[State.RESUME] = this.params.l10n.statusResume;

    AudioRecorderView.data = () => ({
      title: this.params.title,
      state: recorder.supported() ? State.READY : State.UNSUPPORTED,
      statusMessages,
      l10n: this.params.l10n,
      audioSrc: AUDIO_SRC_NOT_SPECIFIED,
      audioFilename: '',
      avgMicFrequency: 0,
      isSubcontent: !this.isRoot()
    });

    // Resize player view
    this.on('resize', () => {
      viewModel.resize();
    });

    // Create recording wrapper view
    const viewModel = new Vue({
      ...AudioRecorderView,
      components: {
        timer: Timer,
        vuMeter: VUMeter
      }
    });

    this.on('resize', () => {
      const view = document.querySelector('.h5p-audio-recorder-view');

      if (!this.contentBody) {
        this.contentBody = H5P.jQuery(view).parents('body').get(0);
      }

      // Assuming that height > 200 and width > 480 are enough to display full dialog
      const presumablyEnoughSpace = this.contentBody.offsetHeight > 200 && this.contentBody.offsetWidth > 480;

      if (!this.isNarrowView && !presumablyEnoughSpace && this.confirmationDialog && this.confirmationDialog.offsetTop + this.confirmationDialog.offsetHeight > this.contentBody.offsetHeight) {
        this.setNarrowView(true);
      }
      else if (this.isNarrowView && presumablyEnoughSpace) {
        this.setNarrowView(false);
      }
    });

    // resize iframe on state change
    viewModel.$watch('state', (state) => {
      this.viewState = state;
      this.trigger('kllStoreSessionState', undefined, { bubbles: true, external: true });
      this.trigger('resize');
    });

    // Start recording when record button is pressed
    viewModel.$on('recording', () => {
      recorder.start();
    });

    viewModel.$on('done', () => {
      recorder.stop();
      recorder.getWavURL().then(url => {
        recorder.releaseMic();
        viewModel.audioSrc = url;

        // Create a filename using the title
        if (params.title && params.title.length > 0) {
          const filename = params.title.substr(0, 20);
          viewModel.audioFilename = filename.toLowerCase().replace(/ /g, '-') + '.wav';
        }

        this.trigger('resize');
      }).catch(e => {
        viewModel.state = State.CANT_CREATE_AUDIO_FILE;
        console.error(params.l10n.statusCantCreateTheAudioFile, e);
      });
    });

    viewModel.$on('retry', () => {
      recorder.releaseMic();
      viewModel.audioSrc = AUDIO_SRC_NOT_SPECIFIED;
    });

    viewModel.$on('paused', () => {
      recorder.pause();
    });

    // Update UI when on recording events
    recorder.on('recording', () => {
      viewModel.state = State.RECORDING;

      // Start update loop for microphone frequency
      this.updateMicFrequency();
    });

    // Blocked probably means user has no mic, or has not allowed access to one
    recorder.on('blocked', () => {
      viewModel.state = State.BLOCKED;
    });

    // May be sent from Chrome, which don't allow use of mic when using http (need https)
    recorder.on('insecure-not-allowed', () => {
      viewModel.state = State.INSECURE_NOT_ALLOWED;
    });

    // Retry confirmation dialog opened
    viewModel.$on('confirmation-dialog-opened', (dialog) => {
      this.confirmationDialog = dialog;
      this.trigger('resize');
    });

    // Retry confirmation dialog closed
    viewModel.$on('confirmation-dialog-closed', () => {
      this.setNarrowView(false);
      this.confirmationDialog = null;
    });

    if (this.viewState === State.DONE || this.viewState === State.RESUME) {
      viewModel.resume();
    }

    /**
     * Set narrow view.
     * @param {boolean} state If true, set view, if false, remove view.
     */
    this.setNarrowView = (state) => {
      if (typeof state !== 'boolean' || !this.confirmationDialog) {
        return;
      }

      if (state) {
        this.confirmationDialog.classList.add('narrow-view');
        this.confirmationDialog.style.top = 0;
        this.contentBody.style.overflow = 'hidden';
        this.isNarrowView = true;
      }
      else {
        this.isNarrowView = false;
        this.confirmationDialog.classList.remove('narrow-view');
        this.contentBody.style.overflow = '';
        this.confirmationDialog.style.top = '40px'; // Default value set in H5P core
      }
    };

    /**
     * Initialize microphone frequency update loop. Will run until no longer recording.
     */
    this.updateMicFrequency = function () {
      // Stop updating if no longer recording
      if (viewModel.state !== State.RECORDING) {
        window.cancelAnimationFrame(this.animateVUMeter);
        return;
      }

      // Grab average microphone frequency
      viewModel.avgMicFrequency = recorder.getAverageMicFrequency();

      // Throttle updating slightly
      setTimeout(() => {
        this.animateVUMeter = window.requestAnimationFrame(() => {
          this.updateMicFrequency();
        });
      }, 10);
    };

    /**
     * Attach library to wrapper
     *
     * @param {jQuery} $wrapper
     */
    this.attach = function ($wrapper) {
      $wrapper.get(0).appendChild(rootElement);
      viewModel.$mount(rootElement);
    };

    /**
     * Trigger xAPI "completed" event.
     */
    this.triggerXAPICompleted = () => {
      const xAPIEvent = this.createXAPIEventTemplate('completed');

      // Definition
      H5P.jQuery.extend(
        xAPIEvent.getVerifiedStatementValue(['object', 'definition']),
        {
          name: { 'en-US': this.getTitle() },
          description: { 'en-US': this.getDescription() },
          interactionType: 'other',
          type: 'http://adlnet.gov/expapi/activities/cmi.interaction'
        }
      );

      this.trigger(xAPIEvent);
    };

    /**
     * Trigger file export.
     * @param {object} data Any data to be exported.
     */
    this.triggerFileExport = (data) => {
      // Set content id
      if (!data.contentId) {
        data.contentId = this.contentId;
      }

      // Set subcontent id (if is subcontent)
      if (!data.subContentId && this.subContentId) {
        data.subContentId = this.subContentId;
      }

      // Set user just like xAPI actor
      if (!data.user) {
        const event = new H5P.XAPIEvent();
        event.setActor();
        data.user = event.data.statement.actor;
      }

      data.description = data.description || this.getTitle();

      this.triggerXAPICompleted();

      this.trigger(
        'exportFile',
        data,
        { external: true }
      );
    };

    /**
     * Get title.
     * @return {string} Title.
     */
    this.getTitle = () => {
      let raw;
      if (this.contentData.metadata) {
        raw = this.contentData.metadata.title;
      }
      raw = raw || DEFAULT_DESCRIPTION;

      // H5P Core function: createTitle
      return H5P.createTitle(raw);
    };

    /**
     * Get description.
     * @return {string} Description.
     */
    this.getDescription = () => {
      if (this.params && this.params.title && this.params.title !== '') {
        return this.params.title;
      }

      return DEFAULT_DESCRIPTION;
    };

    /**
     * Get current state.
     */
    this.getCurrentState = () => {
      return {
        viewState: this.viewState
      };
    };
  }
}
