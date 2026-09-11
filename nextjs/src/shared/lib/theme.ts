export const THEME_KEY = 'pay-theme';

/**
 * Runs in <head> before the first paint, so a stored preference does not flash. The
 * stylesheet also has a prefers-color-scheme fallback, so without JavaScript the page still
 * picks a side — this only honours an explicit choice.
 */
export const THEME_BOOTSTRAP = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})}catch(e){}var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',t||(d?'dark':'light'))})()`;
