function doGet() {
  return HtmlService.createHtmlOutputFromFile('client/index')
    .setTitle('Welcome');
}
