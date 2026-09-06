/**
 * Stats.gs
 *
 * Monthly analytics for the Statisztika and Ranglista pages: hours worked
 * vs planned, Sundays worked, longest consecutive-workday streak, favorite
 * area. Reads only the already parsed "LastSnapshot" - never touches the
 * spreadsheet directly. Reuses helpers already defined in DayInfo.gs
 * (loadSnapshot_, findStudentShift_, parseShiftHours_, paidHours_,
 * isoToDate_, dateToIso_) and Parse.gs (tabNameForDate_).
 */

/**
 * Returns stats for `tabName` (e.g. "2026 Augusztus") from `studentName`'s
 * perspective, or null if the tab wasn't parsed, no name was given, or the
 * caller lacks sheet access.
 *
 * hoursWorked is null when `tabName` isn't the tab containing today - "hours
 * worked so far" doesn't make sense for a month that hasn't started yet.
 */
function getMonthStats(tabName, studentName) {
  return requireAccess_(function() {
    if (!studentName) return null;

    var snapshot = loadSnapshot_();
    var tabData = snapshot[tabName];
    if (!tabData) return null;

    return computeStatsForName_(tabData, studentName, tabName);
  }, null)();
}

/**
 * Returns stats for every distinct name found in `tabName`'s tab, for the
 * Ranglista leaderboard. Each entry has the same shape as getMonthStats
 * plus a `name` field. Empty array if the tab wasn't parsed, or the caller
 * lacks sheet access.
 */
function getLeaderboard(tabName) {
  return requireAccess_(function() {
    var snapshot = loadSnapshot_();
    var tabData = snapshot[tabName];
    if (!tabData) return [];

    return collectTabNames_(tabData).map(function(name) {
      var stats = computeStatsForName_(tabData, name, tabName);
      stats.name = name;
      return stats;
    });
  }, [])();
}

/** Every distinct name assigned to a shift anywhere in `tabData`. */
function collectTabNames_(tabData) {
  var names = {};
  Object.keys(tabData).forEach(function(iso) {
    Object.keys(tabData[iso]).forEach(function(area) {
      tabData[iso][area].forEach(function(shift) {
        if (shift.name) names[shift.name] = true;
      });
    });
  });
  return Object.keys(names).sort();
}

/**
 * Core aggregation shared by getMonthStats and getLeaderboard: walks every
 * date in `tabData` and tallies one person's hours, pay, streak, etc.
 */
function computeStatsForName_(tabData, studentName, tabName) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var isCurrentTab = tabName === tabNameForDate_(today);
  var todayIso = dateToIso_(today);

  var dates = Object.keys(tabData).sort();

  var hoursPlanned = 0;
  var hoursWorked = 0;
  var payPlanned = 0;
  var payEarned = 0;
  var sundaysWorked = 0;
  var daysWorked = 0;
  var areaCounts = {};
  var longestStreak = 0;
  var currentStreak = 0;
  var prevIso = null;

  dates.forEach(function(iso) {
    var shift = findStudentShift_(tabData[iso], studentName);

    if (!shift) {
      currentStreak = 0;
      prevIso = iso;
      return;
    }

    var date = isoToDate_(iso);
    var hours = paidHours_(parseShiftHours_(shift.time));
    var pay = hours * hourlyRateForDate_(date);

    daysWorked++;
    hoursPlanned += hours;
    payPlanned += pay;
    if (isCurrentTab && iso <= todayIso) {
      hoursWorked += hours;
      payEarned += pay;
    }
    if (date.getDay() === 0) sundaysWorked++;
    areaCounts[shift.area] = (areaCounts[shift.area] || 0) + 1;

    var isConsecutiveDay = prevIso &&
      date.getTime() - isoToDate_(prevIso).getTime() === 86400000;
    currentStreak = isConsecutiveDay ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);

    prevIso = iso;
  });

  return {
    hoursPlanned: hoursPlanned,
    hoursWorked: isCurrentTab ? hoursWorked : null,
    payPlanned: payPlanned,
    payEarned: isCurrentTab ? payEarned : null,
    sundaysWorked: sundaysWorked,
    longestStreak: longestStreak,
    favoriteArea: findFavoriteArea_(areaCounts),
    daysWorked: daysWorked,
    avgShiftHours: daysWorked ? hoursPlanned / daysWorked : 0
  };
}

function findFavoriteArea_(areaCounts) {
  var favoriteArea = null;
  var favoriteCount = 0;

  Object.keys(areaCounts).forEach(function(area) {
    if (areaCounts[area] > favoriteCount) {
      favoriteArea = area;
      favoriteCount = areaCounts[area];
    }
  });

  return favoriteArea;
}
