/**
 * Calendar.gs
 *
 * Syncs a student's shifts into a calendar of their choosing. Every managed
 * event is tagged with SYNC_TAG_ in its description so the syncer can tell
 * "mine" apart from anything else on the calendar - only tagged events are
 * ever created, updated, or deleted; everything else is left untouched, so
 * this calendar can be shared with other user-defined events.
 *
 * Trigger ownership: installable time-driven triggers run as whichever
 * Google account created them, and PropertiesService.getUserProperties() is
 * per-user - so a trigger created by student A's own enableSync() call
 * reads/writes A's own properties when it fires, with no extra plumbing.
 */

var SYNC_TAG_ = '#decathlondiak';
var SYNC_TRIGGER_FN_ = 'syncCalendar_';
var SYNC_INTERVAL_MINUTES_ = 5;

/** Calendars the calling user has access to, for the picker dropdown. */
function getCalendarList() {
  return requireAccess_(function() {
    return CalendarApp.getAllCalendars().map(function(cal) {
      return { id: cal.getId(), name: cal.getName() };
    });
  }, [])();
}

/**
 * Current sync state for the calling user: whether it's on, and which
 * calendar (id + name) it targets. `blockedReason` explains why the
 * Settings toggle should be disabled ('no-access' | 'no-name' | null).
 */
function getSyncSettings() {
  var props = PropertiesService.getUserProperties();
  var calendarId = props.getProperty('SyncCalendarId');
  var triggerId = props.getProperty('SyncTriggerId');

  var blockedReason = null;
  if (!hasSheetAccess()) blockedReason = 'no-access';
  else if (!getDiakNeve()) blockedReason = 'no-name';

  var calendarName = null;
  if (calendarId) {
    try {
      var cal = CalendarApp.getCalendarById(calendarId);
      calendarName = cal ? cal.getName() : null;
    } catch (e) {
      calendarName = null; // calendar deleted or no longer accessible
    }
  }

  return {
    enabled: !!triggerId,
    calendarId: calendarId || null,
    calendarName: calendarName,
    blockedReason: blockedReason
  };
}

/**
 * Turns sync on: stores the chosen calendar, (re)creates the 5-minute
 * installable trigger, and runs one sync immediately so events show up
 * right away instead of waiting for the first tick.
 */
function enableSync(calendarId) {
  return requireAccess_(function() {
    if (!getDiakNeve()) return { success: false, reason: 'no-name' };
    if (!calendarId) return { success: false, reason: 'no-calendar' };

    disableSyncTriggerOnly_(); // replace any existing trigger rather than stacking

    var props = PropertiesService.getUserProperties();
    props.setProperty('SyncCalendarId', calendarId);

    var trigger = ScriptApp.newTrigger(SYNC_TRIGGER_FN_)
      .timeBased()
      .everyMinutes(SYNC_INTERVAL_MINUTES_)
      .create();
    props.setProperty('SyncTriggerId', trigger.getUniqueId());

    syncCalendar_(); // immediate first pass, as the calling user (props are already saved above)

    return { success: true };
  }, { success: false, reason: 'no-access' })();
}

/** Turns sync off: deletes the trigger and forgets the chosen calendar. Leaves any already-created events in place. */
function disableSync() {
  disableSyncTriggerOnly_();
  PropertiesService.getUserProperties().deleteProperty('SyncCalendarId');
  return { success: true };
}

/** +/-1 year window around today - wide enough to catch stale tagged events from any past sync window, not just whatever's currently in the parsed snapshot. */
function wideSyncRange_() {
  var start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  var end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  return { start: start, end: end };
}

/**
 * Deletes every SYNC_TAG_-tagged event from `calendarId`, regardless of
 * whether sync is currently on for it - lets the user reset a calendar
 * (e.g. before switching to a different one) without waiting for the
 * scheduler to reconcile it away naturally. Untagged events are never
 * touched.
 */
function clearSyncedEvents(calendarId) {
  return requireAccess_(function() {
    if (!calendarId) return { success: false, reason: 'no-calendar' };

    var calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) return { success: false, reason: 'no-calendar' };

    var range = wideSyncRange_();
    var deleted = 0;
    calendar.getEvents(range.start, range.end).forEach(function(event) {
      if ((event.getDescription() || '').indexOf(SYNC_TAG_) !== -1) {
        event.deleteEvent();
        deleted++;
      }
    });

    return { success: true, deleted: deleted };
  }, { success: false, reason: 'no-access' })();
}

function disableSyncTriggerOnly_() {
  var props = PropertiesService.getUserProperties();
  var triggerId = props.getProperty('SyncTriggerId');
  if (!triggerId) return;

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getUniqueId() === triggerId) ScriptApp.deleteTrigger(trigger);
  });
  props.deleteProperty('SyncTriggerId');
}

/**
 * Trigger handler - runs as whichever user's trigger fired, so
 * getDiakNeve()/PropertiesService.getUserProperties() already resolve to
 * that user.
 */
function syncCalendar_() {
  var props = PropertiesService.getUserProperties();
  var calendarId = props.getProperty('SyncCalendarId');
  var studentName = getDiakNeve();
  if (!calendarId || !studentName || !hasSheetAccess()) return;

  performSync_(calendarId, studentName);
}

/**
 * Client-callable manual sync for the Settings page's "Szinkronizálás"
 * button - runs immediately against whichever calendar is selected,
 * independent of whether automatic sync is turned on for it.
 */
function runSyncNow(calendarId) {
  return requireAccess_(function() {
    var studentName = getDiakNeve();
    if (!studentName) return { success: false, reason: 'no-name' };
    if (!calendarId) return { success: false, reason: 'no-calendar' };

    performSync_(calendarId, studentName);
    return { success: true };
  }, { success: false, reason: 'no-access' })();
}

/**
 * Rebuilds `studentName`'s expected shifts from the parsed snapshot and
 * reconciles them against SYNC_TAG_-tagged events already on `calendarId`,
 * within the same date range as the parsed snapshot (current + next month)
 * - not a wider window. This means a tagged event from a month that has
 * since rolled out of the snapshot won't be found or cleaned up here; use
 * the "Események törlése" button (clearSyncedEvents, which searches
 * wideSyncRange_ instead) for that kind of full reset.
 */
function performSync_(calendarId, studentName) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return;

  var shifts = collectStudentShifts_(studentName); // [{isoDate, area, time, payFt}, ...]

  var bounds = getSnapshotDateBounds_(loadSnapshot_());
  if (!bounds.min) return;
  var rangeStart = isoToDate_(bounds.min);
  var rangeEnd = new Date(isoToDate_(bounds.max).getTime() + 86400000); // exclusive

  var existing = calendar.getEvents(rangeStart, rangeEnd).filter(function(event) {
    return (event.getDescription() || '').indexOf(SYNC_TAG_) !== -1;
  });

  var existingByDate = {};
  existing.forEach(function(event) {
    existingByDate[dateToIso_(event.getStartTime())] = event;
  });

  var expectedDates = {};
  shifts.forEach(function(shift) {
    expectedDates[shift.isoDate] = true;

    var start = shiftTimeToDate_(shift.isoDate, shift.time, 0);
    var end = shiftTimeToDate_(shift.isoDate, shift.time, 1);
    var description = SYNC_TAG_ + '\nemployee: ' + studentName + '\narea: ' + shift.area + '\npay: ' + formatFt_(shift.payFt);

    var event = existingByDate[shift.isoDate];
    if (event) {
      event.setTime(start, end);
      event.setTitle('Munkanap');
      event.setDescription(description);
    } else {
      calendar.createEvent('Munkanap', start, end, { description: description });
    }
  });

  existing.forEach(function(event) {
    if (!expectedDates[dateToIso_(event.getStartTime())]) event.deleteEvent();
  });
}

/** This student's shifts across every parsed month: [{isoDate, area, time, payFt}, ...]. */
function collectStudentShifts_(studentName) {
  var snapshot = loadSnapshot_();
  var shifts = [];

  Object.keys(snapshot).forEach(function(tabName) {
    var tabData = snapshot[tabName];
    Object.keys(tabData).forEach(function(isoDate) {
      var shift = findStudentShift_(tabData[isoDate], studentName);
      if (!shift) return;

      var date = isoToDate_(isoDate);
      var hours = paidHours_(parseShiftHours_(shift.time));
      shifts.push({ isoDate: isoDate, area: shift.area, time: shift.time, payFt: hours * hourlyRateForDate_(date) });
    });
  });

  return shifts;
}

/** "9-18" -> a Date at 9:00 or 18:00 (partIndex 0 or 1) on isoDate. Handles fractional hours (e.g. "9.5-18"). */
function shiftTimeToDate_(isoDate, time, partIndex) {
  var date = isoToDate_(isoDate);
  var hour = parseFloat(time.split('-')[partIndex]);
  date.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return date;
}

function formatFt_(amount) {
  return Math.round(amount).toLocaleString('hu-HU') + ' Ft';
}
