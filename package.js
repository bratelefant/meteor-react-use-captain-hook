Package.describe({
  name: "bratelefant:meteor-react-use-captain-hook",
  version: "0.0.1",
  // Brief, one-line summary of the package.
  summary:
    "Meteor react package for intelligently fetching data from meteor subscriptions or via methods with offline and cache support.",
  // URL to the Git repository containing the source code for this package.
  git: "https://github.com/bratelefant/meteor-react-use-captain-hook.git",
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: "README.md",
});

Package.onUse(function (api) {
  api.versionsFrom("2.7.1");
  api.use("ecmascript");
  api.use("react-meteor-data");
  api.use("meteor");
  api.use("ejson");
  api.use("typescript");
  api.use("mongo");
  Npm.depends({
    react: "16.13.1",
    dexie: "3.2.1",
    underscore: "1.13.1",
  });

  api.addFiles("./lib/GroundedCollection.ts", "client");
  api.mainModule("client.js", "client");
});

Package.onTest(function (api) {
  api.use("ecmascript");
  api.use("tinytest");
  api.use("bratelefant:meteor-react-use-captain-hook");
  api.mainModule("meteor-react-use-captain-hook-tests.js");
});
