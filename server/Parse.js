/**
 * Parse.gs
 *
 * Parses the shift schedule spreadsheet and saves the result into the
 * "LastSnapshot" script property.
 *
 * Output shape:
 * {
 *   "2026 Augusztus": {
 *     "2026-08-01": {
 *       "fitti": [ {"time": "9-18", "name": "Julcsi"}, {"time": "14-20", "name": null} ],
 *       "hegy":  [ ... ]
 *     },
 *     ...
 *   },
 *   "2026 Szeptember": { ... }
 * }
 */

var HUNGARIAN_MONTHS_ = [
  'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
  'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'
];

var AREA_TERMINATOR_LABEL_ = 'óraszám';

var MANUAL_REFRESH_COOLDOWN_MS_ = 30000;

/**
 * Client-callable manual refresh, for the navbar button. Global cooldown
 * (shared Script Property, not per-user) since it protects the one shared
 * parse operation, not an individual's usage.
 *
 * Returns { success: true }, { success: false, secondsRemaining } while on
 * cooldown, or { success: false, reason: 'no-access' } for users without
 * sheet access (requireAccess_'s fallback covers that case).
 */
function requestManualRefresh() {
  return requireAccess_(function() {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('LastManualRefresh') || 0);
    var elapsed = Date.now() - last;

    if (elapsed < MANUAL_REFRESH_COOLDOWN_MS_) {
      return { success: false, secondsRemaining: Math.ceil((MANUAL_REFRESH_COOLDOWN_MS_ - elapsed) / 1000) };
    }

    props.setProperty('LastManualRefresh', String(Date.now()));
    parseSpreadsheet(); // already guarded itself; access is already confirmed here anyway
    return { success: true };
  }, { success: false, reason: 'no-access' })();
}

/**
 * Parses the current month's and next month's tabs and saves the result
 * into the "LastSnapshot" script property.
 *
 * Must be a `function` declaration (not a var) - google.script.run only
 * exposes those. The guard is still applied inline via an immediately
 * invoked closure, so no separate unwrapped function exists to call.
 */
function parseSpreadsheet() {
  return requireAccess_(function() {
    var props = PropertiesService.getScriptProperties();
    var ss = SpreadsheetApp.openById(props.getProperty('SpreadSheetID'));

    var result = {};
    getTargetTabNames_(new Date()).forEach(function(tabName) {
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      result[tabName] = parseTab_(sheet);
    });

    props.setProperty('LastSnapshot', JSON.stringify(result));
  }, undefined)();
}

/** Returns the tab names to parse: previous, current, and next month. */
function getTargetTabNames_(baseDate) {
  var previous = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
  var current = baseDate;
  var next = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
  return [tabNameForDate_(previous), tabNameForDate_(current), tabNameForDate_(next)];
}

function tabNameForDate_(date) {
  return date.getFullYear() + ' ' + HUNGARIAN_MONTHS_[date.getMonth()];
}

/** Parses a single month tab into { isoDate: { area: [shift, ...] } }. */
function parseTab_(sheet) {
  var year = parseInt(sheet.getSheetName().split(' ')[0], 10);
  var days = getDayColumns_(sheet, year);
  var areas = getAreaRanges_(sheet);

  var byDate = {};
  days.forEach(function(day) {
    byDate[day.isoDate] = {};
    areas.forEach(function(area) {
      var shifts = parseAreaShiftsForDay_(sheet, area, day.timeCol);
      if (shifts.length > 0) {
        byDate[day.isoDate][area.name] = shifts;
      }
    });
  });

  return byDate;
}

/**
 * Reads the header row (row 1) and returns each day's column pair.
 * A day spans two columns: [timeCol] holds the date label (e.g. "08.01."),
 * [timeCol + 1] is the merged/blank sibling column.
 */
function getDayColumns_(sheet, year) {
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var days = [];
  for (var col = 1; col < lastCol; col++) { // skip col A (labels)
    var isoDate = cellToIsoDate_(headerRow[col], year);
    if (isoDate) {
      days.push({ timeCol: col + 1, isoDate: isoDate }); // +1: 1-indexed sheet column
    }
  }
  return days;
}

/**
 * Converts a header cell to "YYYY-MM-DD". Handles both real Date objects
 * (Sheets often stores date-labeled cells as dates, not strings) and plain
 * "08.01." style text.
 */
function cellToIsoDate_(cell, year) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var label = String(cell || '').trim();
  if (!label) return null;

  var match = label.match(/^(\d{2})\.(\d{2})\.?$/);
  if (!match) return null;
  return year + '-' + match[1] + '-' + match[2];
}

/**
 * Scans column A top-to-bottom and returns each area's name and row range.
 * An area starts on a bold row whose background differs from the previous row's,
 * and ends on the row labeled "óraszám" (exclusive of that row).
 */
function getAreaRanges_(sheet) {
  var lastRow = sheet.getLastRow();
  var colA = sheet.getRange(1, 1, lastRow, 1);
  var values = colA.getValues();
  var backgrounds = colA.getBackgrounds();
  var fontWeights = colA.getFontWeights();

  var areas = [];
  var current = null;
  var prevBackground = null;

  for (var row = 0; row < lastRow; row++) {
    var label = String(values[row][0] || '').trim();
    var isBold = fontWeights[row][0] === 'bold';
    var background = backgrounds[row][0];

    if (!current && isBold && label && background !== prevBackground) {
      // Start at the label row itself, not the row below - some areas (e.g. "szezon")
      // put a shift directly on the label row. Rows with no shift for a given day
      // are skipped later in parseAreaShiftsForDay_, so this is safe for every area.
      current = { name: label, startRow: row + 1 };
    } else if (current && label === AREA_TERMINATOR_LABEL_) {
      current.endRow = row; // exclusive, 1-indexed (row is 0-indexed "óraszám" row)
      areas.push(current);
      current = null;
    }

    prevBackground = background;
  }

  return areas;
}

/** Reads every shift row within an area's range for one day's column pair. */
function parseAreaShiftsForDay_(sheet, area, timeCol) {
  var rowCount = area.endRow - area.startRow + 1;
  if (rowCount <= 0) return [];

  var block = sheet.getRange(area.startRow, timeCol, rowCount, 2).getDisplayValues();

  var shifts = [];
  block.forEach(function(pair) {
    var time = String(pair[0] || '').trim();
    if (!time) return; // no slot defined for this day/area/row
    var name = cleanName_(pair[1]);
    shifts.push({ time: time, name: name });
  });

  return shifts;
}

/**
 * Cleans up a name cell, stripping trailing junk someone typed alongside the
 * name (e.g. "Zexin 10-20!!" -> "Zexin", "Dominik int." -> "Dominik").
 * Keeps legitimate multi-word names (e.g. "K. Dominik") intact by only
 * dropping words after the first one that's junk - a real name word never
 * contains a digit or is "int." (shorthand for "intéző"/trainee note), but
 * a mistaken timeframe, "!!", or that note typically is.
 */
function cleanName_(cell) {
  var raw = String(cell || '').trim();
  if (!raw) return null;

  var words = raw.split(/\s+/);
  var junkIndex = words.findIndex(function(word) {
    return /\d/.test(word) || /^int\.?$/i.test(word);
  });

  var cleaned = junkIndex === -1 ? words : words.slice(0, junkIndex);
  return cleaned.join(' ') || null;
}