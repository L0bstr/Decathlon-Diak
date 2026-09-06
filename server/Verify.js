/**
 * Checks whether the current user (the one accessing the web app)
 * has read access to the source spreadsheet.
 *
 * Requires the web app to be deployed with "Execute as: User accessing the web app",
 * otherwise this always runs as the owner and always returns true.
 *
 * Uses the Advanced Sheets Service with a minimal `fields` mask instead of
 * SpreadsheetApp.openById - it returns a tiny payload instead of loading
 * the whole spreadsheet (all tabs, formatting, protections). Requires
 * enabling "Sheets API" under Services in the Apps Script editor.
 *
 * Result is cached per user for 5 minutes so repeated calls in a session
 * don't repeat the check.
 *
 * Also the client-callable check used to show a clear "you don't have
 * access" message instead of silently degrading every feature. Unguarded
 * on purpose - it IS the access check, so requireAccess_ can't wrap it.
 */
function hasSheetAccess() {
  var cache = CacheService.getUserCache();
  var cached = cache.get('hasSheetAccess');
  if (cached !== null) return cached === 'true';

  var hasAccess = checkSheetAccess_();
  cache.put('hasSheetAccess', String(hasAccess), 300); // 5 minutes
  return hasAccess;
}

function checkSheetAccess_() {
  try {
    Sheets.Spreadsheets.get(
      PropertiesService.getScriptProperties().getProperty('SpreadSheetID'),
      { fields: 'spreadsheetId' }
    );
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Wraps a function so it only runs if the current user has sheet access.
 * Returns `fallback` instead of running fn when access is missing, so
 * callers get a value back rather than a thrown error to catch.
 *
 * Usage:
 *   const getSnapshot = requireAccess_(function() { ... }, null);
 *   const getNames = requireAccess_(function() { ... }, []);
 */
function requireAccess_(fn, fallback) {
  return function(...args) {
    if (!hasSheetAccess()) {
      return fallback;
    }
    return fn.apply(this, args);
  };
}
