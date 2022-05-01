// Import Tinytest from the tinytest Meteor package.
import { Tinytest } from "meteor/tinytest";

// Import and rename a variable exported by use-captain-hook.js.
import { name as packageName } from "meteor/bratelefant:use-captain-hook";

// Write your tests here!
// Here is an example.
Tinytest.add('use-captain-hook - example', function (test) {
  test.equal(packageName, "use-captain-hook");
});
