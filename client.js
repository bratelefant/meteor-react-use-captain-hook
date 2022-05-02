import { useTracker } from "meteor/react-meteor-data";
import { GroundedCollection } from "./lib/GroundedCollection";
import { checkNpmVersions } from "meteor/tmeasday:check-npm-versions";

checkNpmVersions(
  {
    react: "16.14.0",
  },
  "bratelefant:meteor-react-use-captain-hook"
);

const offlineCol = new GroundedCollection("CaptainHookCache");

/**
 * Fetch data via Hook
 * @param {String} subname Name of the subscription or method (cf. ttl)
 * @param {Object} collection The Meteor Collection
 * @param {Object} [filter] Filter applied to result fetching
 * @param {Boolean} [groundit=true] If true, data will be taken to the ground
 * @param {Number} [ttl] If provided, data will be fetched via method with name given by param subname and offline data will be refreshed, iff ttl expired
 * @returns
 */
export const useCaptainHook = (
  subname,
  collection,
  filter = {},
  groundit = true,
  ttl
) => {
  const React = require("../../react");

  if (typeof subname !== "string")
    console.warn("Subscription must be a string.");

  if (typeof collection !== "object")
    console.warn("Collection must be an object.");

  if (ttl && typeof ttl !== "number") console.warn("TTL must be int.");

  if (!filter) filter = {};

  console.log("Using sub/methodname", subname);
  console.log("using collection", collection._name);
  console.log("Applying filter", filter);
  console.log("Take it to the ground?", groundit);
  console.log("This is the ttl", ttl);

  const noDataAvailable = { data: [] };

  const [offlineData, setOfflineData] = React.useState([]);
  const [ready, setReady] = React.useState(false);

  if (ttl) console.log("Setting TTL to ", ttl);

  if (!offlineCol.loaded()) {
    return { ...noDataAvailable, loading: true };
  }

  if (ttl) {
    if (!ready) {
      console.log("offlineCol set, not ready yet");
      console.log("Offline Collection status:", offlineCol.loaded());
      var cache = offlineCol.findOne({ subname });

      if (!cache) {
        console.log("Got no cache entry, setting it to ", {
          subname,
          offlineData: [],
        });
        cache = {
          subname,
          offlineData: [],
        };
        offlineCol.insert(cache);
      } else {
        if (!cache?._syncedAt || new Date() - cache._syncedAt > ttl) {
          console.log("Cache empty or too old. Refresh data.");

          Meteor.call(subname, (err, res) => {
            if (err) console.warn(err);
            console.log("Got this from the method call", res);
            console.log(
              "update it like so: ",
              { subname },
              {
                $set: {
                  _syncedAt: new Date(),
                  offlineData: res,
                },
              }
            );
            offlineCol.update(
              { subname },
              {
                $set: {
                  _syncedAt: new Date(),
                  offlineData: res,
                },
              }
            );

            if (res) {
              setOfflineData(res);
            }
          });
        } else {
          console.log("Relying on offline data from the cache", cache);
          setOfflineData(cache.offlineData);
          setReady(true);
        }
      }
    }
  } else {
    console.log("No ttl set, using live data");
  }

  const { data, loading } = useTracker(() => {
    const gcol = !ttl && groundit && new GroundedCollection(collection._name);

    !ttl && gcol && gcol.waitUntilLoaded();

    const handler = !ttl && Meteor.subscribe(subname);

    !ttl && gcol && gcol.observeSource(collection.find());

    if (!ttl && !gcol && !handler.ready()) {
      return { ...noDataAvailable, loading: true };
    }

    !ttl && gcol && gcol.keep(collection.find(filter));

    const data = !ttl
      ? gcol
        ? gcol.find(filter).fetch()
        : collection.find(filter).fetch()
      : [];

    return { data, loading: false };
  }, []);

  console.log("Returning data " + ttl ? "from offline Cache" : "live", {
    data: ttl && ready ? offlineData : data,
    loading,
  });
  return { data: ttl && ready ? offlineData : data, loading };
};
