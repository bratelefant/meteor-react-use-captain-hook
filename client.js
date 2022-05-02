import { useTracker } from "meteor/react-meteor-data";
import { GroundedCollection } from "./lib/GroundedCollection";
import { checkNpmVersions } from "meteor/tmeasday:check-npm-versions";

checkNpmVersions(
  {
    react: "16.14.0",
  },
  "bratelefant:meteor-react-use-captain-hook"
);
Meteor.call("vfachkuerzel", (err, res) => console.log(err, res));
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

  const noDataAvailable = { data: [] };

  const [offlineData, setOfflineData] = React.useState([]);
  const [ready, setReady] = React.useState(false);
  const [offlineLoading, setOfflineLoading] = React.useState(undefined);

  if (ttl) console.log("Setting TTL to ", ttl);

  const offlineCol = ttl && new GroundedCollection(collection._name + "Cache");

  offlineCol && offlineCol.waitUntilLoaded();

  if (offlineLoading === undefined) {
    if (offlineCol && !offlineCol.loaded()) {
      console.log("Offline Collection not yet loaded");
      setOfflineLoading(true);
    } else {
      console.log("Offline Collection loaded");
      setOfflineLoading(false);
    }
  }

  if (offlineCol && !ready && !offlineLoading) {
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

          setOfflineData(res);
          setReady(true);
        });
      } else {
        console.log("Relying on offline data from the cache");
        setOfflineData(cache.offlineData);
        setReady(true);
      }
    }
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

  return { data: ready && offlineData ? offlineData : data, loading };
};
