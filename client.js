import { useTracker } from "meteor/react-meteor-data";

export const useCaptainHook = (subname, collection, filter = {}) => {
  const { data, loading } = useTracker(() => {
    const noDataAvailable = { data: [] };
    const handler = Meteor.subscribe(subname);
    if (!handler.ready()) {
      return { ...noDataAvailable, loading: true };
    }
    const data = collection.find(filter).fetch();

    return { data, loading: false };
  });
  return { data, loading };
};
