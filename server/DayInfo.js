/**
 * DayInfo.gs
 *
 * Builds the per-day info shown on the Home card: the student's shift (or
 * rest day), pay, coworkers, and day-count stats. Reads only the already
 * parsed "LastSnapshot" script property - never touches the spreadsheet
 * directly.
 */

var WEEKDAY_RATE_FT_ = 2100;
var SUNDAY_RATE_FT_ = 3150;

/**
 * Returns the day info for `dateIso` from `studentName`'s perspective, or
 * null if the date falls outside the parsed snapshot range, no name was
 * given, or the caller lacks sheet access.
 *
 * Not-found shape (name doesn't appear anywhere in the parsed snapshot,
 * e.g. a typo): { notFound: true }
 * Workday shape:
 *   { isWorkday: true, area, time, hours, payFt, coworkers: [{name, area, time}],
 *     daysUntilRestDay: number|null, month: { workdaysLeft, workdaysTotal } }
 * Restday shape:
 *   { isWorkday: false, daysUntilWorkDay: number|null }
 *
 * daysUntilRestDay/daysUntilWorkDay are null when no such day is found
 * before the end of the parsed snapshot - the client decides what to show
 * for that case (e.g. "jövő hónapban" / "kész vagy a hónappal").
 */
function getDayInfo(dateIso, studentName) {
  return requireAccess_(function() {
    if (!studentName) return null;

    var snapshot = loadSnapshot_();
    if (!studentExistsInSnapshot_(snapshot, studentName)) {
      return { notFound: true, months: Object.keys(snapshot) };
    }

    var areas = getDateAreas_(snapshot, dateIso);
    if (areas === null) return null; // date outside the parsed range

    // TODO: a name currently assumed to appear at most once per day across
    // all areas/timeframes. If the sheet ever has the same name in two
    // slots on the same day, findStudentShift_ silently picks the first
    // one - show the user an error popup instead once that's possible.
    var shift = findStudentShift_(areas, studentName);

    return shift
      ? buildWorkdayInfo_(snapshot, dateIso, studentName, shift)
      : buildRestdayInfo_(snapshot, dateIso, studentName);
  }, null)();
}

/** Whether `studentName` appears at all, in any area on any parsed date. */
function studentExistsInSnapshot_(snapshot, studentName) {
  return Object.keys(snapshot).some(function(tabName) {
    var tabData = snapshot[tabName];
    return Object.keys(tabData).some(function(dateIso) {
      return !!findStudentShift_(tabData[dateIso], studentName);
    });
  });
}

function loadSnapshot_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LastSnapshot');
  return raw ? JSON.parse(raw) : {};
}

/** Returns the { area: [shift, ...] } map for a date, or null if its month wasn't parsed. */
function getDateAreas_(snapshot, dateIso) {
  var tabName = tabNameForDate_(isoToDate_(dateIso));
  var tabData = snapshot[tabName];
  if (!tabData) return null;
  return tabData[dateIso] || {};
}

function findStudentShift_(areas, studentName) {
  var found = null;
  Object.keys(areas).forEach(function(area) {
    areas[area].forEach(function(shift) {
      if (!found && shift.name === studentName) {
        found = { area: area, time: shift.time };
      }
    });
  });
  return found;
}

function collectCoworkers_(areas, studentName) {
  var coworkers = [];
  Object.keys(areas).forEach(function(area) {
    areas[area].forEach(function(shift) {
      if (shift.name && shift.name !== studentName) {
        coworkers.push({ name: shift.name, area: area, time: shift.time });
      }
    });
  });
  return coworkers;
}

/** "9-15" -> 6. Assumes same-day shifts (no wrap past midnight). */
function parseShiftHours_(time) {
  var parts = time.split('-');
  return parseFloat(parts[1]) - parseFloat(parts[0]);
}

/** Hungarian labor law: 1 hour unpaid break is mandatory for 7+ hour shifts. */
function paidHours_(rawHours) {
  return rawHours >= 7 ? rawHours - 1 : rawHours;
}

function hourlyRateForDate_(date) {
  return date.getDay() === 0 ? SUNDAY_RATE_FT_ : WEEKDAY_RATE_FT_; // Sunday = 0
}

function buildWorkdayInfo_(snapshot, dateIso, studentName, shift) {
  var date = isoToDate_(dateIso);
  var hours = paidHours_(parseShiftHours_(shift.time));
  var areas = getDateAreas_(snapshot, dateIso) || {};
  var bounds = getSnapshotDateBounds_(snapshot);

  return {
    isWorkday: true,
    area: shift.area,
    time: shift.time,
    hours: hours,
    payFt: hours * hourlyRateForDate_(date),
    isBonusPay: date.getDay() === 0, // Sunday rate is higher
    coworkers: collectCoworkers_(areas, studentName),
    daysUntilRestDay: daysUntil_(snapshot, dateIso, studentName, false, bounds.max),
    month: countMonthWorkdays_(snapshot, dateIso, studentName)
  };
}

function buildRestdayInfo_(snapshot, dateIso, studentName) {
  var bounds = getSnapshotDateBounds_(snapshot);
  return {
    isWorkday: false,
    daysUntilWorkDay: daysUntil_(snapshot, dateIso, studentName, true, bounds.max),
    months: Object.keys(snapshot)
  };
}

/**
 * Counts forward day-by-day from `dateIso` (exclusive) until the student's
 * workday status flips to `wantWorkday`, capped at `maxDateIso`.
 * Returns null if the flip never happens within the parsed range.
 */
function daysUntil_(snapshot, dateIso, studentName, wantWorkday, maxDateIso) {
  if (!maxDateIso) return null; // snapshot has no parsed dates yet (e.g. before first parse trigger)

  var date = isoToDate_(dateIso);
  var max = isoToDate_(maxDateIso);
  var count = 0;

  while (date.getTime() < max.getTime()) {
    date.setDate(date.getDate() + 1);
    count++;

    var areas = getDateAreas_(snapshot, dateToIso_(date)) || {};
    var isWorkday = !!findStudentShift_(areas, studentName);
    if (isWorkday === wantWorkday) return count;
  }

  return null;
}

/**
 * Workdays for `studentName` in `dateIso`'s calendar month: total for the
 * month, and how many remain from `dateIso` onward (inclusive).
 */
function countMonthWorkdays_(snapshot, dateIso, studentName) {
  var tabName = tabNameForDate_(isoToDate_(dateIso));
  var tabData = snapshot[tabName] || {};

  var total = 0;
  var left = 0;

  Object.keys(tabData).forEach(function(iso) {
    if (!findStudentShift_(tabData[iso], studentName)) return;
    total++;
    if (iso > dateIso) left++;
  });

  return { workdaysLeft: left, workdaysTotal: total };
}

/** Earliest and latest date keys present anywhere in the snapshot. */
function getSnapshotDateBounds_(snapshot) {
  var allDates = [];
  Object.keys(snapshot).forEach(function(tabName) {
    allDates = allDates.concat(Object.keys(snapshot[tabName]));
  });
  allDates.sort();
  return { min: allDates[0], max: allDates[allDates.length - 1] };
}

function isoToDate_(dateIso) {
  var parts = dateIso.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function dateToIso_(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}
