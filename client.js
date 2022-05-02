import { useTracker } from "meteor/react-meteor-data";
import { GroundedCollection } from "./lib/GroundedCollection";

/**
 * Fetch data via Hook
 * @param {String} subname Name of the subscription
 * @param {Object} collection The Meteor Collection
 * @param {Object} filter Filter applied to result fetching
 * @param {Boolean} [groundit=true] If true, data will be taken to the ground
 * @returns
 */
export const useCaptainHook = (
  subname,
  collection,
  filter = {},
  groundit = true
) => {
  const { data, loading } = useTracker(() => {
    const noDataAvailable = { data: [] };

    const gcol = groundit && new GroundedCollection(collection._name);

    gcol && gcol.waitUntilLoaded();

    const handler = Meteor.subscribe(subname);

    gcol && gcol.observeSource(collection.find());

    if (!gcol && !handler.ready()) {
      return { ...noDataAvailable, loading: true };
    }

    gcol && gcol.keep(collection.find(filter));

    const data = gcol
      ? gcol.find(filter).fetch()
      : collection.find(filter).fetch();

    return { data, loading: false };
  }, []);
  return { data, loading };
};
