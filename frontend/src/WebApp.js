function doGet() {
  return HtmlService.createTemplateFromFile('frontend/pages/Index')
    .evaluate()
    .setTitle('Decathlon Diák')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
