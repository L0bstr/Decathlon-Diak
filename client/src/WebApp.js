/**
 * WebApp.gs
 *
 * Entry point for the web app and the client's page-loading endpoint.
 */

/**
 * Returns the "LatestVersionUrl" script property, set manually when a newer
 * deployment exists. Empty string if unset. Read directly by doGet() at
 * render time, not client-callable - the version-check comparison happens
 * server-side now (see doGet), since the client can't reliably read its own
 * URL from inside the sandboxed iframe.
 */
function getLatestVersionUrl() {
  return PropertiesService.getScriptProperties().getProperty('LatestVersionUrl') || '';
}

function doGet() {
  var template = HtmlService.createTemplateFromFile('client/pages/Index');
  template.latestVersionUrl = getLatestVersionUrl();
  template.currentUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('Decathlon Diák')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Returns a page's HTML so it can be injected into the app container client-side.
 * Not access-guarded: page markup itself isn't sensitive, only the data
 * a page later requests is. Guard the data-fetching functions instead.
 */
function getPage(name) {
  return HtmlService.createHtmlOutputFromFile('client/pages/' + name).getContent();
}
