# Idea

Meteors reactivity is the key feature of meteor. DB changes get instantly pushed to the UI (in this case, using react). However, this can be costy on the serverside, since live queries eat up CPU cycles. (cf. [https://web.archive.org/web/20170518115839/https://old.kadira.io/academy/meteor-performance-101/content/optimizing-your-app-for-live-queries]) This is especially relevant, if you're dealing with data from collections that hardly ever get changed.

The idea is now to create a universal hook for react, that fetches data from any wanted subscription just like in the usual meteor fashion, and, if needed, uses grounded collections to store that data for offline use in the clients IndexedDB. As an option, one should be able to pass a method name fetching required data via a method (plus optional parameters) and storing it, for those parameters, directly in an IndexedDB collection, with a specified time-to-live, so that no live query takes place.

# Desired calls

Parameters could be like this

    const useCaptainHook = (subname, collection, filter ={}, groundit = false, methodname, ttl)

where `subname` is the name of the subscription, `collection` is the mongodb collection, filter is an optional filter object for the `.find` part of the collection, `groundit` is an optional flag to take subscription data to the ground and `methodname` is the name of the meteor method to get the same data from the server via a method as the subscription provides, with a specified `ttl`.

The calls that captain hook is about to accept could be like so:

    // Get live data from posts
    const { data, loading, syncing } = useCaptainHook("posts", { author: "John" }, true )

    const { data, loading, syncing } = useCaptainHook( null, null, {author : "John" }, false, "getPosts", 60*60*1000)
