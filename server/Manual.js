/**
 * One-off manual helper - run this from the Apps Script editor (select it
 * in the function dropdown, then Run) to update LatestVersionUrl without
 * touching Project Settings > Script properties directly.
 */
function setLatestVersionUrl() {
   const url = "https://script.google.com/macros/s/AKfycbwI9UfYFik7qCZ5cEddhmaOe5sRQVeKdgK7nRyZvb6BMHvCgGwbjRA5v6mQXZiW4NRAwQ/exec"
  PropertiesService.getScriptProperties().setProperty('LatestVersionUrl', url || '');
}
