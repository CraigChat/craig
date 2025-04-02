import globals from 'globals';

export const browser = {
  languageOptions: {
    globals: {
      ...globals.browser
    }
  }
};
