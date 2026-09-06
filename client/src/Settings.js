/**
 * Settings.gs
 *
 * Per-user settings, stored in User Properties (private to each user).
 */

function getDiakNeve() {
  return PropertiesService.getUserProperties().getProperty('DiakNeve') || '';
}

function saveDiakNeve(name) {
  PropertiesService.getUserProperties().setProperty('DiakNeve', name);
}

/**
 * Combines getDiakNeve + getNames + getSyncSettings into one call so the
 * Settings page only needs a single round trip on load. The calendar list
 * is only fetched when sync is actually usable (no blockedReason) - no
 * point paying for CalendarApp.getAllCalendars() otherwise.
 */
function getSettingsData() {
  var sync = getSyncSettings();
  return {
    diakNeve: getDiakNeve(),
    names: getNames(),
    sync: sync,
    calendars: sync.blockedReason ? [] : getCalendarList()
  };
}

/**
 * Returns the list of known employee names from the last parsed snapshot,
 * for autocomplete. Falls back to an empty list for users without sheet
 * access - this only degrades the UX, it doesn't block the feature.
 */
function getNames() {
  return requireAccess_(function() {
    var snapshot = loadSnapshot_();
    var names = {};

    Object.keys(snapshot).forEach(function(tabName) {
      collectTabNames_(snapshot[tabName]).forEach(function(name) {
        names[name] = true;
      });
    });

    return Object.keys(names).sort();
  }, [])();
}
