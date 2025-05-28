import type { IconifyIcon } from '@iconify/svelte';
import appIcon from '@iconify-icons/mdi/application';
import fileIcon from '@iconify-icons/mdi/file';
import textIcon from '@iconify-icons/mdi/file-document';
import soundIcon from '@iconify-icons/mdi/music-note';
import scriptIcon from '@iconify-icons/mdi/script';
import zipIcon from '@iconify-icons/mdi/zip-box';
import auditionIcon from '@iconify-icons/simple-icons/adobeaudition';
import audacityIcon from '@iconify-icons/simple-icons/audacity';

export const loadingIcon: IconifyIcon = {
  width: 24,
  height: 24,
  body: '<defs><linearGradient id="mingcuteLoadingFill0" x1="50%" x2="50%" y1="5.271%" y2="91.793%"><stop offset="0%" stop-color="currentColor"/><stop offset="100%" stop-color="currentColor" stop-opacity=".55"/></linearGradient><linearGradient id="mingcuteLoadingFill1" x1="50%" x2="50%" y1="15.24%" y2="87.15%"><stop offset="0%" stop-color="currentColor" stop-opacity="0"/><stop offset="100%" stop-color="currentColor" stop-opacity=".55"/></linearGradient></defs><g fill="none"><path d="M24 0v24H0V0zM12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035c-.01-.004-.019-.001-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427c-.002-.01-.009-.017-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093c.012.004.023 0 .029-.008l.004-.014l-.034-.614c-.003-.012-.01-.02-.02-.022m-.715.002a.023.023 0 0 0-.027.006l-.006.014l-.034.614c0 .012.007.02.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"/><path fill="url(#mingcuteLoadingFill0)" d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.502 7.502 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021" transform="translate(1.5 1.625)"/><path fill="url(#mingcuteLoadingFill1)" d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.475 10.475 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118" transform="translate(1.5 1.625)"/></g>'
};

export function getFileIcon(file: string) {
  const extension = file.split('.').reverse()[0];

  switch (extension) {
    case 'aup':
      return audacityIcon;
    case 'sesx':
      return auditionIcon;
    case 'zip':
      return zipIcon;
    case 'flac':
    case 'mp3':
    case 'wav':
    case 'aac':
    case 'ogg':
    case 'opus':
    case 'oga':
      return soundIcon;
    case 'txt':
      return textIcon;
    case 'sh':
    case 'command':
      return scriptIcon;
    case 'exe':
      return appIcon;
    default:
      return fileIcon;
  }
}
