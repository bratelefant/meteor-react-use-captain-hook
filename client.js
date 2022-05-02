import { useTracker } from "meteor/react-meteor-data";
import { GroundedCollection } from "./lib/GroundedCollection";
import { checkNpmVersions } from "meteor/tmeasday:check-npm-versions";

checkNpmVersions(
  {
    react: "16.14.0",
  },
  "bratelefant:meteor-react-use-captain-hook"
);

const React = require("react");

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
  if (typeof subname !== "string")
    console.warn("Subscription must be a string.");

  if (typeof collection !== "object")
    console.warn("Collection must be an object.");

  if (ttl && typeof ttl !== "number") console.warn("TTL must be int.");

  if (!filter) filter = {};

  const [offlineData, setOfflineData] = React.useState([]);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setReady(false);
  }, []);

  const offlineCol = ttl && new GroundedCollection(collection._name + "Cache");

  if (offlineCol && !ready) {
    const cache = offlineCol.findOne();

    if (!cache) {
      offlineCol.insert({
        offlineData: [],
      });
    } else {
      if (!cache?._syncedAt || new Date() - cache._syncedAt > ttl) {
        console.log("Cache empty or too old. Refresh data.");

        Meteor.call(subname, (err, res) => {
          if (err) console.warn(err);
          offlineCol.update(cache._id, {
            $set: {
              _syncedAt: new Date(),
              offlineData: res,
            },
          });
          setOfflineData(res);
        });
      } else {
        console.log("Relying on offline data from the cache");
        setOfflineData(cache.offlineData);
        setReady(true);
      }
    }
  }

  if (ready && offlineCol) return { data: offlineData, loading: false };

  const { data, loading } = useTracker(() => {
    const noDataAvailable = { data: [] };

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

  return { data, loading };
};
