import { useTracker } from "meteor/react-meteor-data";
import {
  GroundedCollection,
  waitUntilReactive,
} from "./lib/GroundedCollection";

export const useCaptainHook = (
  subname,
  collection,
  filter = {},
  groundit = true
) => {
  const { data, loading } = useTracker(() => {
    const noDataAvailable = { data: [] };

    const gcol = groundit && new GroundedCollection(collection._name);

    gcol.waitUntilLoaded();

    const handler = Meteor.subscribe(subname);

    if (gcol) {
      gcol.observeSource(collection.find());
    }

    if (!gcol && !handler.ready()) {
      return { ...noDataAvailable, loading: true };
    }

    if (gcol) gcol.keep(collection.find(filter));

    const data = gcol
      ? gcol.find(filter).fetch()
      : collection.find(filter).fetch();

    return { data, loading: false };
  }, []);
  return { data, loading };
};
